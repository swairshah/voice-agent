import os
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from fastrtc import ReplyOnPause, Stream, get_stt_model, get_tts_model
import anthropic

client = anthropic.Anthropic()

stt_model = get_stt_model()
tts_model = get_tts_model()

# handler receives audio, converts it to text, sends it to the LLM, then streams TTS audio back.
def echo(audio):
    prompt = stt_model.stt(audio)
    print(prompt)
    response = client.messages.create(
        model="claude-3-5-sonnet-20241022",
        max_tokens=100,
        messages=[{"role": "user", "content": prompt}]
    )
    reply_text = response.content[0].text
    print(reply_text)

    # Optionally, you might yield the updated chat history as an extra output here.
    # Then stream TTS audio for the reply.
    for audio_chunk in tts_model.stream_tts_sync(reply_text):
        yield audio_chunk

stream = Stream(ReplyOnPause(echo), modality="audio", mode="send-receive")

app = FastAPI()

# Mount the FastRTC endpoints (this sets up the necessary WebRTC/SSE endpoints)
stream.mount(app)

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    with open("static/index.html", "r") as f:
        return HTMLResponse(content=f.read(), status_code=200)
