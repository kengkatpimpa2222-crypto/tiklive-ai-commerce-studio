# Architecture

```
Control window (React)  ──REST──▶  API (Fastify, in Electron main)  ──WS StageCommand──▶  Stage (React, #/stage)
        ▲                                │  LiveDirector                                     │ SpeechEngine (Web Speech / remote TTS)
        └─────────── WS state ───────────┘  HostBrain + compliance                           │ AvatarController → SVG avatar
                                                                    ◀──── speech_done ───────┘
Stage → OBS Browser Source / window capture → TikTok LIVE Studio or official stream key
```

* **LiveDirector** plays the script one sentence at a time, inserts AI disclosures (start + every 15 min),
  answers queued viewer questions between steps or in Q&A windows, and logs events for the summary.
  Each sentence is compliance-checked immediately before it is sent to the stage.
* The stage reports `speech_done`; if no stage is open the director advances on an estimated duration so the show never stalls.
* Preview iframes connect as `preview`: they render but stay silent and never advance the show.
* Lip sync: text → viseme timeline (Thai vowel/consonant classes + Latin), re-timed by speech boundary events
  or the decoded audio length; with remote TTS the jaw also follows real audio RMS.
* Storage is a local JSON file in the app's user-data folder.
