"""Streamlit + WebRTC wrapper around the excavator game."""

from __future__ import annotations

import os
from dataclasses import dataclass

import av
import streamlit as st
from streamlit_webrtc import RTCConfiguration, WebRtcMode, webrtc_streamer

from gesture import Game

os.environ.setdefault("SDL_VIDEODRIVER", "dummy")

st.set_page_config(
    page_title="Excavator Game (Render)",
    page_icon="🚜",
    layout="wide",
)

st.title("🚜 Excavator Game — Render/WebRTC")
st.markdown(
    "This runs the pygame + MediaPipe excavator game on the server. "
    "Your browser supplies webcam frames; the server returns rendered frames."
)


@dataclass
class ControlState:
    throttle: float = 1.0
    boost: bool = False


if "controls" not in st.session_state:
    st.session_state.controls = ControlState()

controls: ControlState = st.session_state.controls
controls.throttle = st.sidebar.slider("Throttle", 0.25, 4.0, controls.throttle, 0.05)
controls.boost = st.sidebar.toggle("Boost x1.5 (hold)", value=controls.boost)

st.sidebar.caption(
    "Lower the throttle if MediaPipe tracking is struggling or network latency is high."
)

game = Game()

RTC_CONF = RTCConfiguration({"iceServers": [{"urls": ["stun:stun.l.google.com:19302"]}]})


class VideoProcessor:
    def recv(self, frame: av.VideoFrame) -> av.VideoFrame:  # pragma: no cover - runtime only
        img = frame.to_ndarray(format="bgr24")
        out = game.tick(img, throttle=controls.throttle, boost=controls.boost)
        return av.VideoFrame.from_ndarray(out, format="bgr24")


webrtc_streamer(
    key="excavator-game",
    mode=WebRtcMode.SENDRECV,
    rtc_configuration=RTC_CONF,
    media_stream_constraints={"video": True, "audio": False},
    video_processor_factory=VideoProcessor,
    async_processing=True,
)

st.markdown(
    "Allow camera permissions when prompted. If the video freezes, refresh the page or lower the throttle."
)
