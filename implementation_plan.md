# Implement Apple-Like Music Scrubber

The goal is to make the music widget's progress bar (scrubber) interactive and controllable, resembling Apple's Dynamic Island or iOS Lock Screen media controls.

## User Review Required

> [!WARNING]
> **Technical Limitation on Windows ARM64**
> Your system is running an ARM64 architecture without the required Windows SDKs or Python build tools. Because of this, it is fundamentally impossible to natively fetch the real-time playback position or send a "seek to X seconds" command directly to apps like Spotify without an API key.

## Proposed Approach

Since we cannot hook into the native Windows Media Transport Controls (SMTC) directly for seeking on your machine, I propose the following workaround to give you the Apple-like feel:

1. **Track Duration via iTunes**: When we detect a song (via the window title), we already query the iTunes API for album art. I will update this to also grab the `trackTimeMillis` so we know exactly how long the song is.
2. **Simulated Progress Bar**: The Notch will run an internal timer that visually increments the scrubber to match the track's length.
3. **Interactive UI**: I will make the progress bar fully draggable (like Apple's UI). You can scrub it back and forth, and the time will update.
4. **Playback Controls**: The Play, Pause, Next, and Previous buttons will be fully functional and will correctly send media keys to Windows.

## Open Questions

> [!IMPORTANT]
> Because of the system limitations, dragging the scrubber will update the UI, but it **will not physically seek the song inside Spotify**. 
> 
> Is this acceptable for the aesthetic you want? Or did you mean you wanted the "Apple like bar" to control your **System Volume** instead of music progress?

## Verification Plan
1. Play a song and ensure the scrubber begins moving automatically based on the iTunes duration.
2. Drag the scrubber and verify the UI updates smoothly.
3. Ensure the play/pause/skip buttons function properly.
