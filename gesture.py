"""Core excavator game logic and gesture processing.

This module contains a reusable ``Game`` object that can be fed webcam
frames and will return rendered frames for display.  It is designed to
work in headless environments (``SDL_VIDEODRIVER=dummy``) and can be
integrated with streamlit-webrtc or other video streaming backends.
"""

from __future__ import annotations

import math
import os
import random
from typing import Optional

import cv2
import mediapipe as mp
import numpy as np
import pygame

# Ensure pygame never tries to open an on-device window when we are running
# inside a headless container.  If a different video driver is already set we
# honour it.
os.environ.setdefault("SDL_VIDEODRIVER", "dummy")

SCREEN_W, SCREEN_H = 800, 600

mp_hands = mp.solutions.hands


class Game:
    """Main excavator game state.

    The object keeps all scene state between frames.  Call :meth:`tick` with a
    BGR numpy frame to update controls and receive the rendered scene.
    """

    def __init__(self) -> None:
        pygame.init()
        # Off-screen surface; we never create a window.
        self.surface = pygame.Surface((SCREEN_W, SCREEN_H))
        self.clock = pygame.time.Clock()

        # --- World configuration -------------------------------------------------
        self.WORLD_W = 3200
        self.GROUND_BASE = 550
        self.GROUND_AMP_BASE = 40.0
        self.GROUND_SCALE_BASE = 360.0

        # Scene tween state
        self.scene_sky_top = pygame.Color(18, 18, 28)
        self.scene_sky_bot = pygame.Color(30, 32, 46)
        self.scene_ground = (0, 120, 0)
        self.terrain_amp = self.GROUND_AMP_BASE
        self.terrain_scale = self.GROUND_SCALE_BASE
        self.cam_zoom = 1.0

        # Targets we tween toward
        self.target_sky_top = pygame.Color(self.scene_sky_top)
        self.target_sky_bot = pygame.Color(self.scene_sky_bot)
        self.target_ground = self.scene_ground
        self.target_amp = self.terrain_amp
        self.target_scale = self.terrain_scale
        self.target_zoom = self.cam_zoom

        # Depth layers for parallax (name, parallax, fog strength)
        self.LAYERS = [
            ("sky", 0.20, 0.65),
            ("clouds", 0.30, 0.55),
            ("mountains", 0.45, 0.50),
            ("trees", 0.70, 0.35),
            ("near", 1.00, 0.18),
        ]

        self.camera_x = 0.0

        # Game objects -----------------------------------------------------------
        self.balls: list[list[float]] = []
        self.basket = [self.WORLD_W - 150, self.ground_y_at(self.WORLD_W - 100) - 50, 100, 50]
        self.score = 0
        self.scooped_ball: Optional[list[float]] = None
        self.excavator_pos = [420.0, self.ground_y_at(420.0) - 50]

        # Movement parameters
        self.EXCAVATOR_SPEED_MAX = 8.0
        self.EXCAVATOR_ACCEL = 0.65
        self.EXCAVATOR_DRAG = 0.85
        self.left_track_v = 0.0
        self.right_track_v = 0.0

        # Boom / arm configuration
        self.first_boom_length = 100
        self.second_boom_length = 80
        self.first_boom_angle = 0.0
        self.second_boom_angle = 0.0
        self.BOOM_CONTROL_RATE_BASE = 0.10
        self.DEAD_ZONE_WIDTH = 0.15
        self.BOOM_ANGLE_LIMIT_LEFT = math.pi / 1
        self.BOOM_ANGLE_LIMIT_RIGHT = math.pi / 2

        self.mode = "arm"
        self.left_movement = False

        # Timer / scoring -------------------------------------------------------
        self.ROUND_DURATION = 90
        self.TIME_BONUS_PER_SCORE = 5
        self.TIME_CAP = 120
        self.BASE_POINTS = 100
        self.COMBO_WINDOW = 4.0
        self.COMBO_STEP = 0.25
        self.COMBO_MAX_MULT = 3.0
        self.PRESSURE_MAX_MULT = 3.0
        self.game_over = False
        self.time_bonus_ms = 0
        self.start_ticks = pygame.time.get_ticks()
        self.last_score_time: Optional[float] = None
        self.combo_count = 0

        self.particles: list[dict[str, float]] = []

        # Scene ranges for tweening
        self.SCENES = [
            (0, 800, pygame.Color(18, 18, 28), pygame.Color(30, 32, 46), (0, 120, 0),
             self.GROUND_AMP_BASE, self.GROUND_SCALE_BASE, 1.00),
            (800, 1700, pygame.Color(20, 24, 40), pygame.Color(32, 36, 56), (10, 130, 15),
             self.GROUND_AMP_BASE * 1.1, self.GROUND_SCALE_BASE * 0.95, 1.15),
            (1700, 2600, pygame.Color(22, 26, 46), pygame.Color(35, 38, 60), (15, 135, 18),
             self.GROUND_AMP_BASE * 1.25, self.GROUND_SCALE_BASE * 0.90, 1.28),
            (2600, 4000, pygame.Color(24, 28, 52), pygame.Color(38, 42, 66), (20, 140, 20),
             self.GROUND_AMP_BASE * 1.35, self.GROUND_SCALE_BASE * 0.86, 1.35),
        ]

        self.spawn_balls()

        # MediaPipe Hands processor
        self.hands = mp_hands.Hands(min_detection_confidence=0.7,
                                     min_tracking_confidence=0.5,
                                     max_num_hands=2)

    # ------------------------------------------------------------------ helpers
    def ground_y_at(self, x_world: float) -> float:
        return self.GROUND_BASE - self.terrain_amp * math.sin(x_world / self.terrain_scale)

    def world_to_screen(self, wx: float, wy: float) -> tuple[int, int]:
        cx = self.camera_x + SCREEN_W * 0.5
        sx = (wx - cx) * self.cam_zoom + SCREEN_W * 0.5
        sy = (wy - self.GROUND_BASE) * self.cam_zoom + self.GROUND_BASE
        return int(sx), int(sy)

    def spawn_balls(self) -> None:
        self.balls.clear()
        for _ in range(18):
            bx = random.randint(80, self.WORLD_W - 80)
            by = self.ground_y_at(bx) - 10
            self.balls.append([bx, by])

    def update_scene_targets(self, x: float) -> None:
        for sx, ex, sky_t, sky_b, ground, amp, scale, zoom in self.SCENES:
            if sx <= x < ex:
                self.target_sky_top = pygame.Color(sky_t)
                self.target_sky_bot = pygame.Color(sky_b)
                self.target_ground = ground
                self.target_amp = amp
                self.target_scale = scale
                self.target_zoom = zoom
                return

    # ------------------------------------------------------------- scoring/time
    def remaining_time_sec(self) -> int:
        elapsed_ms = pygame.time.get_ticks() - self.start_ticks
        total_ms = min((self.ROUND_DURATION * 1000) + self.time_bonus_ms, self.TIME_CAP * 1000)
        return max(0, int((total_ms - elapsed_ms) // 1000))

    def time_pressure_multiplier(self) -> float:
        rem = self.remaining_time_sec()
        t = 1.0 - (rem / self.TIME_CAP)
        return 1.0 + t * (self.PRESSURE_MAX_MULT - 1.0)

    def combo_multiplier(self, now_sec: float) -> float:
        if self.last_score_time is None or (now_sec - self.last_score_time) > self.COMBO_WINDOW:
            self.combo_count = 1
        else:
            self.combo_count += 1
        self.last_score_time = now_sec
        mult = 1.0 + (self.combo_count - 1) * self.COMBO_STEP
        return min(mult, self.COMBO_MAX_MULT)

    def add_score_and_time(self) -> None:
        now_sec = pygame.time.get_ticks() / 1000.0
        tp = self.time_pressure_multiplier()
        cm = self.combo_multiplier(now_sec)
        gained = int(self.BASE_POINTS * tp * cm)
        self.score += gained
        self.time_bonus_ms = min(
            self.time_bonus_ms + self.TIME_BONUS_PER_SCORE * 1000,
            (self.TIME_CAP - self.ROUND_DURATION) * 1000,
        )

    # ------------------------------------------------------------------- update
    def tick(self, frame_bgr, throttle: float = 1.0, boost: bool = False):
        """Advance the game by one frame.

        Parameters
        ----------
        frame_bgr:
            Incoming frame from the browser in BGR order.
        throttle:
            Scalar applied to vehicle speed/acceleration.
        boost:
            Whether to apply an additional boost multiplier.
        """

        if frame_bgr is None:
            frame_bgr = self._blank_frame()

        if not self.game_over:
            frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            results = self.hands.process(frame_rgb)

            hands_list = list(results.multi_hand_landmarks or [])
            left_hand = hands_list[0] if len(hands_list) > 0 else None
            right_hand = hands_list[1] if len(hands_list) > 1 else None

            # Movement and throttle handling
            th = throttle * (1.5 if boost else 1.0)
            eff_speed = self.EXCAVATOR_SPEED_MAX * th
            eff_accel = self.EXCAVATOR_ACCEL * th

            if left_hand:
                lw = left_hand.landmark[mp_hands.HandLandmark.WRIST]
                li = left_hand.landmark[mp_hands.HandLandmark.INDEX_FINGER_TIP]
                if li.x < lw.x - self.DEAD_ZONE_WIDTH:
                    self.left_track_v = max(self.left_track_v - eff_accel, -eff_speed)
                    self.right_track_v = max(self.right_track_v - eff_accel, -eff_speed)
                elif li.x > lw.x + self.DEAD_ZONE_WIDTH:
                    self.left_track_v = min(self.left_track_v + eff_accel, eff_speed)
                    self.right_track_v = min(self.right_track_v + eff_accel, eff_speed)
                else:
                    self.left_track_v *= self.EXCAVATOR_DRAG
                    self.right_track_v *= self.EXCAVATOR_DRAG
            else:
                self.left_track_v *= self.EXCAVATOR_DRAG
                self.right_track_v *= self.EXCAVATOR_DRAG

            # Simple boom gesture from right hand - raise/lower bucket
            if right_hand:
                rw = right_hand.landmark[mp_hands.HandLandmark.WRIST]
                ri = right_hand.landmark[mp_hands.HandLandmark.INDEX_FINGER_TIP]
                dy = ri.y - rw.y
                rate = self.BOOM_CONTROL_RATE_BASE * th
                self.first_boom_angle = max(-self.BOOM_ANGLE_LIMIT_RIGHT,
                                            min(self.BOOM_ANGLE_LIMIT_LEFT,
                                                self.first_boom_angle + dy * rate))

            # Apply kinematics
            vx = (self.left_track_v + self.right_track_v) * 0.5
            self.excavator_pos[0] = max(0, min(self.WORLD_W - 50, self.excavator_pos[0] + vx))
            self.excavator_pos[1] = self.ground_y_at(self.excavator_pos[0]) - 50
            self.camera_x = max(0, min(self.WORLD_W - SCREEN_W, self.excavator_pos[0] - SCREEN_W * 0.5))

            self.update_scene_targets(self.excavator_pos[0])
            self._lerp_scene()

            if self.remaining_time_sec() <= 0:
                self.game_over = True

        frame_bgr_out = self._render()
        self.clock.tick(30)
        return frame_bgr_out

    # ---------------------------------------------------------------- rendering
    def _render(self):
        s = self.surface
        s.fill(self.scene_sky_bot)

        # Ground strip
        step = 10
        pts = []
        start = int(self.camera_x // step) * step - 20
        end = start + SCREEN_W + 40
        for x in range(start, end + 1, step):
            xw = max(0, min(self.WORLD_W, x))
            sx, sy = self.world_to_screen(xw, self.ground_y_at(xw))
            pts.append((sx, sy))
        pts.append((SCREEN_W, SCREEN_H))
        pts.append((0, SCREEN_H))
        pygame.draw.polygon(s, self.scene_ground, pts)

        # Basket
        bx, by, bw, bh = self.basket
        sx, sy = self.world_to_screen(bx, by)
        pygame.draw.rect(s, (128, 0, 160), (sx, sy, bw * self.cam_zoom, bh * self.cam_zoom), border_radius=6)

        # Excavator
        ex, ey = self.world_to_screen(*self.excavator_pos)
        pygame.draw.rect(s, (0, 128, 255), (ex, ey, 50 * self.cam_zoom, 50 * self.cam_zoom), border_radius=6)

        # Balls
        for (x, y) in self.balls:
            sx2, sy2 = self.world_to_screen(x, y)
            pygame.draw.circle(s, (240, 210, 60), (sx2, sy2), max(3, int(10 * self.cam_zoom)))

        font = pygame.font.SysFont(None, 28)
        t_left = self.remaining_time_sec()
        s.blit(font.render(f"Score: {self.score}", True, (240, 240, 240)), (10, 10))
        s.blit(font.render(f"Time: {t_left:02d}s", True,
                           (255, 200, 140) if t_left > 10 else (255, 120, 120)),
               (SCREEN_W - 140, 10))

        frame_rgb = pygame.surfarray.array3d(s).swapaxes(0, 1)
        frame_bgr_out = cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR)
        return frame_bgr_out

    def _lerp_scene(self):
        def lerp(a, b, t):
            return a + (b - a) * t

        def color_lerp(ca, cb, t):
            return pygame.Color(
                int(lerp(ca.r, cb.r, t)),
                int(lerp(ca.g, cb.g, t)),
                int(lerp(ca.b, cb.b, t)),
            )

        self.scene_sky_top = color_lerp(self.scene_sky_top, self.target_sky_top, 0.03)
        self.scene_sky_bot = color_lerp(self.scene_sky_bot, self.target_sky_bot, 0.03)
        self.scene_ground = (
            int(lerp(self.scene_ground[0], self.target_ground[0], 0.05)),
            int(lerp(self.scene_ground[1], self.target_ground[1], 0.05)),
            int(lerp(self.scene_ground[2], self.target_ground[2], 0.05)),
        )
        self.terrain_amp = lerp(self.terrain_amp, self.target_amp, 0.03)
        self.terrain_scale = lerp(self.terrain_scale, self.target_scale, 0.03)
        self.cam_zoom = lerp(self.cam_zoom, self.target_zoom, 0.04)

    def _blank_frame(self):
        return np.zeros((SCREEN_H, SCREEN_W, 3), dtype=np.uint8)


__all__ = ["Game", "SCREEN_W", "SCREEN_H"]
