import assert from 'node:assert/strict';
import { parseDshowAudioDevices, parseLinuxAudioDevices, listAudioInputDevices } from './audioDevices.js';

console.log('Running AudioDevices unit tests...');

// 1. Test DirectShow stderr output parsing
const sampleDshowStderr = `
[dshow @ 0000021c32608000] DirectShow video devices (some may be both video and audio devices)
[dshow @ 0000021c32608000]  "Integrated Camera"
[dshow @ 0000021c32608000]     Alternative name "@device_pnp_\\\\?\\usb#vid_04f2&pid_b6d9&mi_00#6&37ff4d46&0&0000#{65e8773d-8f56-11d0-a3b9-00a0c9223196}\\global"
[dshow @ 0000021c32608000] DirectShow audio devices
[dshow @ 0000021c32608000]  "Microphone Array (Realtek(R) Audio)"
[dshow @ 0000021c32608000]     Alternative name "@device_cm_{33d9a761-90c8-11d0-bd43-00a0c911ce86}\\wave_{95BCF217-48DF-413F-9DA4-9A4BC9BD09A9}"
[dshow @ 0000021c32608000]  "Stereo Mix (Realtek(R) Audio)"
[dshow @ 0000021c32608000]     Alternative name "@device_cm_{33d9a761-90c8-11d0-bd43-00a0c911ce86}\\wave_{D003FD11-A5BC-4903-BB1A-A4276A8D0819}"
dummy: Immediate exit requested
`;

const parsed = parseDshowAudioDevices(sampleDshowStderr);
assert.equal(parsed.length, 2);
assert.equal(parsed[0], 'Microphone Array (Realtek(R) Audio)');
assert.equal(parsed[1], 'Stereo Mix (Realtek(R) Audio)');
console.log('✅ PASS: parseDshowAudioDevices extracts audio devices correctly');

// 2. Test Linux pactl output parsing
const samplePactl = `
0 alsa_output.pci-0000_00_1f.3.analog-stereo.monitor module-alsa-card.c s16le 2ch 44100Hz RUNNING
1 alsa_input.pci-0000_00_1f.3.analog-stereo module-alsa-card.c s16le 2ch 44100Hz SUSPENDED
`;
const parsedLinux = parseLinuxAudioDevices(samplePactl);
assert.equal(parsedLinux.length, 1);
assert.equal(parsedLinux[0], 'alsa_input.pci-0000_00_1f.3.analog-stereo');
console.log('✅ PASS: parseLinuxAudioDevices filters sources accurately');

// 3. Test listAudioInputDevices returns baseline items
const devices = await listAudioInputDevices();
assert(Array.isArray(devices));
assert(devices.length >= 2);
assert.equal(devices[0]!.id, 'none');
assert.equal(devices[1]!.id, 'default');
console.log('✅ PASS: listAudioInputDevices returns expected baseline fallback items');

console.log('All AudioDevices tests passed successfully! 🎉');
