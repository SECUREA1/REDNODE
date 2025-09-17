import cv2
import mediapipe as mp
import pygame
import pygame.gfxdraw as gfx
import math
import random

# -----------------------------
# Setup
# -----------------------------
mp_hands = mp.solutions.hands
hands = mp_hands.Hands(min_detection_confidence=0.7, min_tracking_confidence=0.5, max_num_hands=2)

pygame.init()
SCREEN_W, SCREEN_H = 800, 600
screen = pygame.display.set_mode((SCREEN_W, SCREEN_H))
clock = pygame.time.Clock()

# -----------------------------
# World & Camera (with depth)
# -----------------------------
WORLD_W = 3200
GROUND_BASE = 550
GROUND_AMP_BASE = 40
GROUND_SCALE_BASE = 360.0

# Scene state (tweened)
scene_sky_top = pygame.Color(18, 18, 28)
scene_sky_bot = pygame.Color(30, 32, 46)
scene_ground = (0, 120, 0)
terrain_amp = GROUND_AMP_BASE
terrain_scale = GROUND_SCALE_BASE
cam_zoom = 1.0

# Targets we tween toward
target_sky_top = scene_sky_top
target_sky_bot = scene_sky_bot
target_ground = scene_ground
target_amp = terrain_amp
target_scale = terrain_scale
target_zoom = cam_zoom

def lerp(a, b, t): return a + (b - a) * t

def color_lerp(ca, cb, t):
    return pygame.Color(
        int(lerp(ca.r, cb.r, t)),
        int(lerp(ca.g, cb.g, t)),
        int(lerp(ca.b, cb.b, t))
    )

def ground_y_at(x_world: float) -> float:
    return GROUND_BASE - terrain_amp * math.sin(x_world / terrain_scale)

# Camera center follows excavator in X; Y is side-view so fixed
camera_x = 0.0

def world_to_screen(wx, wy):
    cx = camera_x + SCREEN_W * 0.5
    sx = (wx - cx) * cam_zoom + SCREEN_W * 0.5
    sy = (wy - GROUND_BASE) * cam_zoom + GROUND_BASE
    return sx, sy

# -----------------------------
# Depth layers (back -> front)
# -----------------------------
LAYERS = [
    ("sky",       0.20, 0.65),
    ("clouds",    0.30, 0.55),
    ("mountains", 0.45, 0.50),
    ("trees",     0.70, 0.35),
    ("near",      1.00, 0.18),
]

def layer_shift(parallax):
    return camera_x * (1.0 - parallax)

def draw_vertical_gradient(surface, top_color, bottom_color):
    for y in range(SCREEN_H):
        t = y / SCREEN_H
        c = color_lerp(top_color, bottom_color, t)
        pygame.gfxdraw.hline(surface, 0, SCREEN_W, y, c)

def draw_sky(surface):
    draw_vertical_gradient(surface, scene_sky_top, scene_sky_bot)

def draw_clouds(surface, parallax, tsec):
    px = layer_shift(parallax)
    drift = (tsec * 12) % 800
    rnd = random.Random(int(px // 400))
    for _ in range(8):
        base_x = rnd.randint(-120, SCREEN_W + 120)
        x = (base_x + drift) % (SCREEN_W + 240) - 120
        y = rnd.randint(40, 140)
        w = rnd.randint(100, 200)
        h = rnd.randint(30, 60)
        col = color_lerp(scene_sky_top, pygame.Color(220, 220, 235), 0.25)
        cloud = pygame.Surface((w, h), pygame.SRCALPHA)
        pygame.draw.ellipse(cloud, (col.r, col.g, col.b, 110), (0, 0, w, h))
        surface.blit(cloud, (x, y))

def draw_mountains(surface, parallax):
    px = layer_shift(parallax)
    step = 8
    ridge1 = color_lerp(scene_sky_bot, pygame.Color(80, 90, 130), 0.35)
    ridge2 = color_lerp(scene_sky_bot, pygame.Color(60, 70, 110), 0.25)

    for off, amp, col in [(0, 1.0, ridge1), (80, 0.7, ridge2)]:
        pts = []
        for sx in range(-20, SCREEN_W + 40, step):
            wx = max(0, min(WORLD_W, sx + px + off))
            y = GROUND_BASE - 160 - 40 * amp * math.sin(wx / 520.0) - 25 * amp * math.sin(wx / 210.0)
            pts.append((sx, y))
        pts.append((SCREEN_W, 0))
        pts.append((0, 0))
        pygame.draw.polygon(surface, col, pts)

def draw_tree_band(surface, parallax):
    px = layer_shift(parallax)
    rand_seed = int(px // 200)
    rnd = random.Random(rand_seed)
    for _ in range(18):
        sx = rnd.randint(-50, SCREEN_W + 50)
        wx = max(0, min(WORLD_W, sx + px))
        base_y = GROUND_BASE - 90 - 20 * math.sin(wx / 310.0)
        h = rnd.randint(50, 80)
        pygame.gfxdraw.box(surface, pygame.Rect(sx - 3, int(base_y - h), 6, h), (70, 45, 25))
        pygame.draw.polygon(surface, (32, 110, 45),
                            [(sx, base_y - h - 12), (sx - 22, base_y - 32), (sx + 22, base_y - 32)])

def draw_ground_strip(surface):
    step = 10
    pts = []
    start = int(camera_x // step) * step - 20
    end = start + SCREEN_W + 40
    for x in range(start, end + 1, step):
        xw = max(0, min(WORLD_W, x))
        sx, sy = world_to_screen(xw, ground_y_at(xw))
        pts.append((sx, sy))
    pts.append((SCREEN_W, SCREEN_H))
    pts.append((0, SCREEN_H))
    pygame.draw.polygon(surface, scene_ground, pts)

def apply_fog(surface, strength):
    if strength <= 0: return
    fog = pygame.Surface((SCREEN_W, SCREEN_H), pygame.SRCALPHA)
    r, g, b = scene_sky_top.r, scene_sky_top.g, scene_sky_top.b
    fog.fill((r, g, b, int(255 * strength * 0.22)))
    surface.blit(fog, (0, 0))

def apply_vignette(surface):
    vign = pygame.Surface((SCREEN_W, SCREEN_H), pygame.SRCALPHA)
    for y in range(SCREEN_H):
        for x in range(SCREEN_W):
            dx = (x - SCREEN_W/2) / (SCREEN_W/2)
            dy = (y - SCREEN_H/2) / (SCREEN_H/2)
            d = min(1.0, math.sqrt(dx*dx + dy*dy))
            a = int(180 * (d ** 2.0) * 0.22)
            vign.set_at((x, y), (0, 0, 0, a))
    surface.blit(vign, (0, 0))

def render_layers(surface, tsec):
    for name, parallax, fog in LAYERS:
        if name == "sky":
            draw_sky(surface)
            apply_fog(surface, fog)
        elif name == "clouds":
            draw_clouds(surface, parallax, tsec)
            apply_fog(surface, fog)
        elif name == "mountains":
            draw_mountains(surface, parallax)
            apply_fog(surface, fog)
        elif name == "trees":
            draw_tree_band(surface, parallax)
            apply_fog(surface, fog)
        elif name == "near":
            draw_ground_strip(surface)

# -----------------------------
# Game Objects
# -----------------------------
balls = []
def spawn_balls():
    balls.clear()
    for _ in range(18):
        bx = random.randint(80, WORLD_W - 80)
        by = ground_y_at(bx) - 10
        balls.append([bx, by])

basket = [WORLD_W - 150, ground_y_at(WORLD_W - 100) - 50, 100, 50]

score = 0
scooped_ball = None

# Excavator body (world coords)
excavator_pos = [420.0, ground_y_at(420.0) - 50]
EXCAVATOR_SPEED_MAX = 8.0
EXCAVATOR_ACCEL = 0.65
EXCAVATOR_DRAG = 0.85
left_track_v = 0.0
right_track_v = 0.0

# Arm
first_boom_length = 100
second_boom_length = 80
first_boom_angle = 0.0
second_boom_angle = 0.0
BOOM_CONTROL_RATE_BASE = 0.10   # (renamed) base rate
BUCKET_CONTROL_RATE_BASE = 0.10 # (kept for parity)
DEAD_ZONE_WIDTH = 0.15
BOOM_ANGLE_LIMIT_LEFT = math.pi / 1
BOOM_ANGLE_LIMIT_RIGHT = math.pi / 2

# Modes
mode = "arm"  # "arm" or "drive"

# -----------------------------
# Scene gates (inward)
# -----------------------------
SCENES = [
    (0,   800,  pygame.Color(18,18,28),  pygame.Color(30,32,46), (0,120,0),     GROUND_AMP_BASE,      GROUND_SCALE_BASE,      1.00),
    (800, 1700, pygame.Color(20,24,40),  pygame.Color(32,36,56), (10,130,15),   GROUND_AMP_BASE*1.1,  GROUND_SCALE_BASE*0.95, 1.15),
    (1700,2600, pygame.Color(22,26,46),  pygame.Color(35,38,60), (15,135,18),   GROUND_AMP_BASE*1.25, GROUND_SCALE_BASE*0.90, 1.28),
    (2600,4000, pygame.Color(24,28,52),  pygame.Color(38,42,66), (20,140,20),   GROUND_AMP_BASE*1.35, GROUND_SCALE_BASE*0.86, 1.35),
]

def update_scene_targets(x):
    global target_sky_top, target_sky_bot, target_ground, target_amp, target_scale, target_zoom
    for sx, ex, sky_t, sky_b, ground, amp, scale, zoom in SCENES:
        if sx <= x < ex:
            target_sky_top = sky_t
            target_sky_bot = sky_b
            target_ground = ground
            target_amp = amp
            target_scale = scale
            target_zoom = zoom
            return

# -----------------------------
# Particles (dust)
# -----------------------------
particles = []
def spawn_dust(xw, yw, speed):
    count = int(max(0, min(6, abs(speed) * 0.25)))
    for _ in range(count):
        ang = random.uniform(math.pi, math.pi*2)
        v = random.uniform(0.5, 2.0)
        particles.append({
            "x": xw + random.uniform(-10, 10),
            "y": yw + 50 + random.uniform(-5, 3),
            "vx": math.cos(ang) * v,
            "vy": -abs(math.sin(ang)) * v * 0.3,
            "life": random.uniform(0.4, 0.9)
        })

def update_particles(dt):
    dead = []
    for p in particles:
        p["life"] -= dt
        p["x"] += p["vx"]
        p["y"] += p["vy"]
        p["vy"] += 0.03
        if p["life"] <= 0:
            dead.append(p)
    for p in dead:
        particles.remove(p)

def draw_particles(surface):
    for p in particles:
        a = int(130 * max(0, min(1, p["life"])))
        col = (90, 80, 60, a)
        sx, sy = world_to_screen(p["x"], p["y"])
        pygame.gfxdraw.filled_circle(surface, int(sx), int(sy), max(1, int(2*cam_zoom)), col)

# -----------------------------
# THROTTLE SYSTEM (NEW)
# -----------------------------
THROTTLE_MIN = 0.25
THROTTLE_MAX = 4.0
THROTTLE_STEP = 0.10
BOOST_MULT = 1.5           # while holding Left Shift
throttle = 1.0             # persistent throttle value

def current_throttle():
    keys = pygame.key.get_pressed()
    boost = BOOST_MULT if keys[pygame.K_LSHIFT] or keys[pygame.K_RSHIFT] else 1.0
    return max(THROTTLE_MIN, min(THROTTLE_MAX, throttle)) * boost

# -----------------------------
# Helpers / collisions
# -----------------------------
def aa_line(surface, c, a, b, w=1):
    pygame.draw.line(surface, c, a, b, w)

def draw_boom(surface, base_world, length, angle, color=(255,0,0), width=5):
    end_x = base_world[0] + length * math.cos(angle)
    end_y = base_world[1] + length * math.sin(angle)
    a = world_to_screen(*base_world)
    b = world_to_screen(end_x, end_y)
    aa_line(surface, color, a, b, max(1, int(width * cam_zoom)))
    aa_line(surface, (255, 255, 255), (a[0]+1, a[1]+1), (b[0]+1, b[1]+1), 1)
    return end_x, end_y

def draw_scooper(surface, base_world, length, angle, color=(0,0,255), width=5):
    end_x = base_world[0] + length * math.cos(angle)
    end_y = base_world[1] + length * math.sin(angle)
    a = world_to_screen(*base_world)
    b = world_to_screen(end_x, end_y)
    aa_line(surface, color, a, b, max(1, int(width * cam_zoom)))
    aa_line(surface, (230, 230, 255), (b[0]-1, b[1]-1), (b[0]+1, b[1]+1), 1)
    return end_x, end_y

# -----------------------------
# SCORE / TIMER SYSTEM
# -----------------------------
ROUND_DURATION = 90
TIME_BONUS_PER_SCORE = 5
TIME_CAP = 120
BASE_POINTS = 100
COMBO_WINDOW = 4.0
COMBO_STEP = 0.25
COMBO_MAX_MULT = 3.0
PRESSURE_MAX_MULT = 3.0

game_over = False
time_bonus_ms = 0
start_ticks = 0
last_score_time = None
combo_count = 0

def remaining_time_sec():
    elapsed_ms = pygame.time.get_ticks() - start_ticks
    total_ms = min((ROUND_DURATION * 1000) + time_bonus_ms, TIME_CAP * 1000)
    remain = max(0, (total_ms - elapsed_ms) // 1000)
    return int(remain)

def time_pressure_multiplier():
    rem = remaining_time_sec()
    cap = TIME_CAP
    t = 1.0 - (rem / cap)
    return 1.0 + t * (PRESSURE_MAX_MULT - 1.0)

def combo_multiplier(now_sec):
    global combo_count, last_score_time
    if last_score_time is None or (now_sec - last_score_time) > COMBO_WINDOW:
        combo_count = 1
    else:
        combo_count += 1
    last_score_time = now_sec
    mult = 1.0 + (combo_count - 1) * COMBO_STEP
    return min(mult, COMBO_MAX_MULT)

def add_score_and_time():
    global score, time_bonus_ms
    now_sec = pygame.time.get_ticks() / 1000.0
    tp = time_pressure_multiplier()
    cm = combo_multiplier(now_sec)
    gained = int(BASE_POINTS * tp * cm)
    score += gained
    time_bonus_ms = min(
        time_bonus_ms + TIME_BONUS_PER_SCORE * 1000,
        (TIME_CAP - ROUND_DURATION) * 1000
    )
    return gained, tp, cm

# -----------------------------
# Collision with basket
# -----------------------------
def check_basket_collision():
    global scooped_ball, game_over
    brect = pygame.Rect(basket)
    if scooped_ball is not None:
        ball_rect = pygame.Rect(balls[scooped_ball][0]-10, balls[scooped_ball][1]-10, 20, 20)
        if brect.colliderect(ball_rect):
            add_score_and_time()
            balls.pop(scooped_ball)
            scooped_ball = None

# -----------------------------
# Hand-driven angles & drive
# -----------------------------
left_movement = False

def calculate_main_boom_angle(hand_lm):
    global left_movement
    if hand_lm:
        rw = hand_lm.landmark[mp_hands.HandLandmark.WRIST]
        ri = hand_lm.landmark[mp_hands.HandLandmark.INDEX_FINGER_TIP]
        dx = (ri.x - rw.x) * SCREEN_W
        dy = (ri.y - rw.y) * SCREEN_H
        ang = math.atan2(dy, dx)

        # dynamic control rate scaled by throttle
        rate = BOOM_CONTROL_RATE_BASE * current_throttle()

        if ri.x < rw.x - DEAD_ZONE_WIDTH:
            left_movement = True
            ang += rate
        elif ri.x > rw.x + DEAD_ZONE_WIDTH:
            left_movement = False
            ang -= rate

        limit = BOOM_ANGLE_LIMIT_LEFT if left_movement else BOOM_ANGLE_LIMIT_RIGHT
        return max(-limit, min(limit, ang))
    return 0.0

def calculate_second_boom_angle(hand_lm):
    # (kept simple; bucket control rate could also be scaled if you add rate usage here)
    if hand_lm:
        ri = hand_lm.landmark[mp_hands.HandLandmark.INDEX_FINGER_TIP]
        rw = hand_lm.landmark[mp_hands.HandLandmark.WRIST]
        dx = rw.x * SCREEN_W - (ri.x * SCREEN_W)
        dy = rw.y * SCREEN_H - (ri.y * SCREEN_H)
        return math.atan2(dy, dx)
    return 0.0

def track_speed_from_hand(hand_lm):
    if not hand_lm:
        return 0.0
    wrist = hand_lm.landmark[mp_hands.HandLandmark.WRIST]
    idx = hand_lm.landmark[mp_hands.HandLandmark.INDEX_FINGER_TIP]
    offset = idx.x - wrist.x
    if abs(offset) < DEAD_ZONE_WIDTH * 0.7:
        return 0.0
    offset = max(-0.5, min(0.5, offset))
    return offset / 0.5  # [-1, 1]

# -----------------------------
# Round control
# -----------------------------
def start_round():
    global score, scooped_ball, left_track_v, right_track_v, excavator_pos
    global first_boom_angle, second_boom_angle, camera_x, game_over
    global time_bonus_ms, start_ticks, last_score_time, combo_count

    score = 0
    scooped_ball = None
    left_track_v = right_track_v = 0.0
    first_boom_angle = second_boom_angle = 0.0
    excavator_pos = [420.0, ground_y_at(420.0) - 50]
    camera_x = max(0, min(WORLD_W - SCREEN_W, excavator_pos[0] - SCREEN_W * 0.5))
    spawn_balls()
    particles.clear()

    game_over = False
    time_bonus_ms = 0
    start_ticks = pygame.time.get_ticks()
    last_score_time = None
    combo_count = 0

# -----------------------------
# Main
# -----------------------------
def main():
    global first_boom_angle, second_boom_angle, camera_x, cam_zoom
    global left_track_v, right_track_v, excavator_pos, scene_sky_top, scene_sky_bot, scene_ground
    global terrain_amp, terrain_scale, mode, game_over, throttle
    global scooped_ball

    cam = cv2.VideoCapture(0)
    mode = "arm"
    start_round()

    running = True
    while running:
        dt = clock.get_time() / 1000.0
        tsec = pygame.time.get_ticks() / 1000.0

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            elif event.type == pygame.KEYDOWN:
                # Toggle mode
                if event.key == pygame.K_TAB and not game_over:
                    mode = "drive" if mode == "arm" else "arm"
                if event.key == pygame.K_r and game_over:
                    start_round()
                if event.key == pygame.K_ESCAPE:
                    running = False
                # Throttle adjust
                if event.key == pygame.K_LEFTBRACKET:
                    throttle = max(THROTTLE_MIN, round(throttle - THROTTLE_STEP, 2))
                if event.key == pygame.K_RIGHTBRACKET:
                    throttle = min(THROTTLE_MAX, round(throttle + THROTTLE_STEP, 2))
                # Quick presets (optional)
                if event.key == pygame.K_1: throttle = 0.5
                if event.key == pygame.K_2: throttle = 1.0
                if event.key == pygame.K_3: throttle = 1.5
                if event.key == pygame.K_4: throttle = 2.0
                if event.key == pygame.K_5: throttle = 3.0

        # stop input when time is up (but still render)
        if not game_over:
            ret, frame = cam.read()
            if not ret:
                break
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = hands.process(frame_rgb)

            hand_list = []
            if results.multi_hand_landmarks:
                for h in results.multi_hand_landmarks:
                    hand_list.append(h)
            left_hand_lm = hand_list[0] if len(hand_list) >= 1 else None
            right_hand_lm = hand_list[1] if len(hand_list) >= 2 else None

            th = current_throttle()
            eff_speed = EXCAVATOR_SPEED_MAX * th
            eff_accel = EXCAVATOR_ACCEL * th
            # (drag unchanged for stability)

            # --- Mode logic
            if mode == "arm":
                if left_hand_lm:
                    main_ang = calculate_main_boom_angle(left_hand_lm)  # uses throttle internally
                    first_boom_angle = max(-BOOM_ANGLE_LIMIT_LEFT, min(BOOM_ANGLE_LIMIT_LEFT, main_ang))
                    lw = left_hand_lm.landmark[mp_hands.HandLandmark.WRIST]
                    li = left_hand_lm.landmark[mp_hands.HandLandmark.INDEX_FINGER_TIP]
                    if li.x < lw.x - DEAD_ZONE_WIDTH:
                        left_track_v = max(left_track_v - eff_accel, -eff_speed)
                        right_track_v = max(right_track_v - eff_accel, -eff_speed)
                    elif li.x > lw.x + DEAD_ZONE_WIDTH:
                        left_track_v = min(left_track_v + eff_accel, eff_speed)
                        right_track_v = min(right_track_v + eff_accel, eff_speed)
                    else:
                        left_track_v *= EXCAVATOR_DRAG
                        right_track_v *= EXCAVATOR_DRAG
                if right_hand_lm:
                    second_boom_angle = calculate_second_boom_angle(right_hand_lm)
            else:
                desired_left = track_speed_from_hand(left_hand_lm)
                desired_right = track_speed_from_hand(right_hand_lm)
                keys = pygame.key.get_pressed()
                if keys[pygame.K_LEFT]:
                    desired_left = desired_right = max(-1.0, desired_left - 0.05)
                if keys[pygame.K_RIGHT]:
                    desired_left = desired_right = min(1.0, desired_left + 0.05)
                if keys[pygame.K_a]:
                    desired_left = max(-1.0, desired_left - 0.05)
                if keys[pygame.K_d]:
                    desired_right = min(1.0, desired_right + 0.05)
                # accelerate toward desired, scaled by throttle
                left_track_v += (desired_left * eff_speed - left_track_v) * 0.25
                right_track_v += (desired_right * eff_speed - right_track_v) * 0.25
                # arm damping
                first_boom_angle *= 0.98
                second_boom_angle *= 0.98

            if mode == "drive" and not (left_hand_lm or right_hand_lm):
                left_track_v *= EXCAVATOR_DRAG
                right_track_v *= EXCAVATOR_DRAG

            # Kinematics
            vx = (left_track_v + right_track_v) * 0.5
            excavator_pos[0] += vx
            excavator_pos[0] = max(0, min(WORLD_W - 50, excavator_pos[0]))
            excavator_pos[1] = ground_y_at(excavator_pos[0]) - 50

            if abs(vx) > 0.1:
                spawn_dust(excavator_pos[0], excavator_pos[1], vx)
            update_particles(dt)

            camera_x = max(0, min(WORLD_W - SCREEN_W, excavator_pos[0] - SCREEN_W * 0.5))

            # Scene transitions
            update_scene_targets(excavator_pos[0])
            scene_sky_top = color_lerp(scene_sky_top, target_sky_top, 0.03)
            scene_sky_bot = color_lerp(scene_sky_bot, target_sky_bot, 0.03)
            scene_ground = (
                int(lerp(scene_ground[0], target_ground[0], 0.05)),
                int(lerp(scene_ground[1], target_ground[1], 0.05)),
                int(lerp(scene_ground[2], target_ground[2], 0.05)),
            )
            terrain_amp = lerp(terrain_amp, target_amp, 0.03)
            terrain_scale = lerp(terrain_scale, target_scale, 0.03)
            cam_zoom = lerp(cam_zoom, target_zoom, 0.04)

            # Timer end?
            if remaining_time_sec() <= 0:
                game_over = True

        # --- Render depth stack
        render_layers(screen, tsec)

        # Basket
        bx, by = basket[0], basket[1]
        sw, sh = 100, 50
        sx, sy = world_to_screen(bx, by)
        pygame.draw.rect(screen, (128, 0, 160), (sx, sy, sw * cam_zoom, sh * cam_zoom), border_radius=int(6*cam_zoom))
        pygame.draw.rect(screen, (200, 140, 240), (sx, sy, sw * cam_zoom, sh * cam_zoom), width=2, border_radius=int(6*cam_zoom))

        # Arm & body (shadow)
        body_sx, body_sy = world_to_screen(*excavator_pos)
        shadow = pygame.Surface((80, 25), pygame.SRCALPHA)
        pygame.draw.ellipse(shadow, (0, 0, 0, 80), (0, 0, 80, 25))
        screen.blit(shadow, (body_sx - 15*cam_zoom, body_sy + 42*cam_zoom))

        end_first = draw_boom(screen, excavator_pos, first_boom_length, first_boom_angle, color=(255, 80, 80))
        end_second = draw_boom(screen, end_first, second_boom_length,
                               first_boom_angle + second_boom_angle, color=(255, 150, 70))
        scooper_pos = draw_scooper(screen, end_second, 22,
                                   first_boom_angle + second_boom_angle + math.pi / 2)

        # Body + tracks
        body_w = 50 * cam_zoom
        body_h = 50 * cam_zoom
        pygame.draw.rect(screen, (0, 128, 255), (body_sx, body_sy, body_w, body_h), border_radius=int(6*cam_zoom))
        pygame.draw.rect(screen, (230, 245, 255), (body_sx, body_sy, body_w, body_h), width=2, border_radius=int(6*cam_zoom))
        track_rect = pygame.Rect(body_sx - 5*cam_zoom, body_sy + 45*cam_zoom, 60*cam_zoom, 12*cam_zoom)
        pygame.draw.rect(screen, (60, 60, 60), track_rect, border_radius=int(3*cam_zoom))
        tread_offset = int((left_track_v + right_track_v) * 2) % 8
        for i in range(0, int(track_rect.width), 8):
            pygame.draw.line(screen, (90, 90, 90),
                             (track_rect.x + i + tread_offset, track_rect.y + 2),
                             (track_rect.x + i + tread_offset, track_rect.y + track_rect.height - 2), 2)

        # Balls with shimmer
        for i, ball in enumerate(balls):
            sx2, sy2 = world_to_screen(ball[0], ball[1])
            r = max(3, int(10 * cam_zoom))
            pygame.gfxdraw.filled_circle(screen, int(sx2), int(sy2), r, (240, 210, 60))
            pygame.gfxdraw.aacircle(screen, int(sx2), int(sy2), r, (255, 235, 120))
            sweep = int((tsec * 180 + i * 20) % (2*r)) - r
            if abs(sweep) < r:
                pygame.gfxdraw.filled_circle(screen, int(sx2 + sweep*0.4), int(sy2 - sweep*0.3), max(1, r//3), (255, 255, 200, 140))

        if scooped_ball is not None:
            balls[scooped_ball] = [scooper_pos[0], scooper_pos[1]]

        # Collisions & scoring
        if not game_over:
            # use helper (prevents UnboundLocal issues)
            srect = pygame.Rect(scooper_pos[0]-15, scooper_pos[1]-15, 30, 30)
            for i, ball in enumerate(balls):
                brect = pygame.Rect(ball[0]-10, ball[1]-10, 20, 20)
                if srect.colliderect(brect) and scooped_ball is None:
                    scooped_ball = i
                    break
            check_basket_collision()

        # Particles
        draw_particles(screen)

        # Post FX
        apply_vignette(screen)

        # HUD
        font = pygame.font.SysFont(None, 28)
        big  = pygame.font.SysFont(None, 64)
        t_left = remaining_time_sec()
        tp_mult = time_pressure_multiplier()
        th_disp = current_throttle()
        hud1 = font.render(f"Score: {score}", True, (240, 240, 240))
        hud2 = font.render(f"Mode: {mode.upper()} (TAB)", True, (200, 220, 255))
        hud3 = font.render(f"Time: {t_left:02d}s", True, (255, 200, 140) if t_left > 10 else (255, 120, 120))
        hud4 = font.render(f"Throttle x{th_disp:.2f}  ([ / ] , Shift boost)", True, (200, 240, 200))
        hud5 = font.render(f"Pressure x{tp_mult:.2f} | Combo x{max(1, 1 + (combo_count-1)*COMBO_STEP):.2f}", True, (200, 255, 200))
        screen.blit(hud1, (10, 10))
        screen.blit(hud2, (10, 38))
        screen.blit(hud3, (SCREEN_W - 120, 10))
        screen.blit(hud4, (10, 66))
        screen.blit(hud5, (10, 94))

        # Game Over overlay
        if game_over:
            overlay = pygame.Surface((SCREEN_W, SCREEN_H), pygame.SRCALPHA)
            overlay.fill((0, 0, 0, 140))
            screen.blit(overlay, (0, 0))
            msg = big.render("GAME OVER", True, (255, 230, 200))
            sub = font.render(f"Final Score: {score}   |   Press R to Restart  •  ESC to Quit", True, (230, 230, 240))
            screen.blit(msg, (SCREEN_W/2 - msg.get_width()/2, SCREEN_H/2 - 60))
            screen.blit(sub, (SCREEN_W/2 - sub.get_width()/2, SCREEN_H/2 + 10))

        pygame.display.flip()
        clock.tick(60)

    cam.release()
    pygame.quit()

if __name__ == "__main__":
    main()
