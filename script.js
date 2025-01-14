document.addEventListener("DOMContentLoaded", () => {
    let audioContext, mediaStream, mediaRecorder, analyser, source, filterNode, audioChunks = [];
    const phonocardiogramCanvas = document.getElementById("phonocardiogramCanvas");
    const audioPlayback = document.getElementById("audioPlayback");
    const downloadButton = document.getElementById("downloadAudio");
    const statusMessage = document.getElementById("statusMessage");
    const preFilterOptions = document.getElementsByName("preFilter");
  
    let canvasContext = phonocardiogramCanvas.getContext("2d");
  
    function resizeCanvas() {
      phonocardiogramCanvas.width = phonocardiogramCanvas.clientWidth;
      phonocardiogramCanvas.height = phonocardiogramCanvas.clientHeight;
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
  
    // Get audio devices
    async function getAudioDevices() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioDeviceSelect = document.getElementById("audioDevice");
        devices.filter(device => device.kind === 'audioinput').forEach(device => {
          const option = document.createElement("option");
          option.value = device.deviceId;
          option.textContent = device.label || `Microphone ${audioDeviceSelect.length + 1}`;
          audioDeviceSelect.appendChild(option);
        });
      } catch (err) {
        statusMessage.textContent = `Error fetching audio devices: ${err.message}`;
      }
    }
  
    function getSelectedPreFilter() {
      for (const option of preFilterOptions) {
        if (option.checked) {
          return option.value;
        }
      }
      return "none";
    }
  
    async function startRecording() {
      try {
        const selectedDeviceId = document.getElementById("audioDevice").value;
        if (!selectedDeviceId) {
          statusMessage.textContent = "Please select an audio input device.";
          return;
        }
  
        const constraints = { audio: { deviceId: selectedDeviceId } };
        mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
  
        source = audioContext.createMediaStreamSource(mediaStream);
  
        const preFilterType = getSelectedPreFilter();
        filterNode = audioContext.createBiquadFilter();
  
        if (preFilterType === "heart") {
          filterNode.type = "bandpass";
          filterNode.frequency.value = 135;
          filterNode.Q = 1.2;
        } else if (preFilterType === "lungs") {
          filterNode.type = "bandpass";
          filterNode.frequency.value = 400;
          filterNode.Q = 1.5;
        } else {
          filterNode = audioContext.createGain();
        }
  
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 4096; // Increased for more data points (slows down movement)
        analyser.smoothingTimeConstant = 0.05;
  
        source.connect(filterNode);
        filterNode.connect(analyser);
        analyser.connect(audioContext.destination);
  
        mediaRecorder = new MediaRecorder(mediaStream, { mimeType: 'audio/webm' });
        audioChunks = [];
        mediaRecorder.ondataavailable = (event) => audioChunks.push(event.data);
        mediaRecorder.onstop = async () => createWavDownload();
  
        mediaRecorder.start();
  
        visualizePhonocardiogram();
        toggleButtons(true);
        statusMessage.textContent = "Recording...";
      } catch (err) {
        statusMessage.textContent = `Error starting recording: ${err.message}`;
      }
    }
  
    function stopRecording() {
      mediaRecorder.stop();
      mediaStream.getTracks().forEach(track => track.stop());
      if (audioContext.state !== 'closed') {
        audioContext.close();
      }
      toggleButtons(false);
      statusMessage.textContent = "Recording stopped.";
    }
  
    async function createWavDownload() {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      const arrayBuffer = await audioBlob.arrayBuffer();
      const decodedAudio = await audioContext.decodeAudioData(arrayBuffer);
      const wavBlob = encodeWav(decodedAudio);
  
      const audioURL = URL.createObjectURL(wavBlob);
      audioPlayback.src = audioURL;
  
      downloadButton.onclick = () => {
        const link = document.createElement("a");
        link.href = audioURL;
        link.download = "heart-sound.wav";
        link.click();
      };
    }
  
    function encodeWav(audioBuffer) {
      const numChannels = audioBuffer.numberOfChannels;
      const sampleRate = audioBuffer.sampleRate;
      const length = audioBuffer.length * numChannels * 2 + 44;
      const buffer = new ArrayBuffer(length);
      const view = new DataView(buffer);
  
      writeString(view, 0, "RIFF");
      view.setUint32(4, length - 8, true);
      writeString(view, 8, "WAVE");
  
      writeString(view, 12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, numChannels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * numChannels * 2, true);
      view.setUint16(32, numChannels * 2, true);
      view.setUint16(34, 16, true);
  
      writeString(view, 36, "data");
      view.setUint32(40, length - 44, true);
  
      let offset = 44;
      for (let i = 0; i < audioBuffer.length; i++) {
        for (let channel = 0; channel < numChannels; channel++) {
          let sample = audioBuffer.getChannelData(channel)[i];
          sample = Math.max(-1, Math.min(1, sample));
          view.setInt16(offset, sample * 0x7fff, true);
          offset += 2;
        }
      }
  
      return new Blob([buffer], { type: "audio/wav" });
    }
  
    function writeString(view, offset, string) {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    }
  
    function visualizePhonocardiogram() {
      const bufferLength = analyser.fftSize;
      const dataArray = new Float32Array(bufferLength);
      const scrollSpeed = 3;
  
      function draw() {
        analyser.getFloatTimeDomainData(dataArray);
  
        // Scroll the canvas to the left
        const imageData = canvasContext.getImageData(scrollSpeed, 0, phonocardiogramCanvas.width - scrollSpeed, phonocardiogramCanvas.height);
        canvasContext.putImageData(imageData, 0, 0);
  
        // Clear the right side where new data will be drawn
        canvasContext.clearRect(phonocardiogramCanvas.width - scrollSpeed, 0, scrollSpeed, phonocardiogramCanvas.height);
  
        // Draw new waveform at the rightmost side
        canvasContext.beginPath();
        let sliceWidth = phonocardiogramCanvas.width / bufferLength;
        let x = phonocardiogramCanvas.width - scrollSpeed;
  
        for (let i = 0; i < bufferLength; i++) {
          let v = (dataArray[i] * 0.5 + 0.5) * phonocardiogramCanvas.height;
          if (i === 0) {
            canvasContext.moveTo(x, v);
          } else {
            canvasContext.lineTo(x, v);
          }
          x += sliceWidth;
        }
  
        canvasContext.strokeStyle = "lime";
        canvasContext.lineWidth = 2;
        canvasContext.stroke();
  
        requestAnimationFrame(draw);
      }
  
      draw();
    }
  
    function toggleButtons(isRecording) {
      document.getElementById("startRecording").disabled = isRecording;
      document.getElementById("stopRecording").disabled = !isRecording;
    }
  
    document.getElementById("startRecording").onclick = startRecording;
    document.getElementById("stopRecording").onclick = stopRecording;
  
    getAudioDevices();
  });
  
