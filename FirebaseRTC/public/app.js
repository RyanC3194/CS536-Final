

let peerConnection = null;
let remoteStream = null;
let localStream = null;
let roomId = null;
let textChannel = null;
let initializedHangup = false;

// Replace this once the OpenRelay TURN server's 50GB quota usage has been reached.
const TURN_API_KEY = "https://nhyao.metered.live/api/v1/turn/credentials?apiKey=28c84515a1faf51ce04566f25404dfa4c3d5";

// IMPORTANT: If testing locally, let useTURN = false; Set to true before deploying on Firebase Hosting.
const useTURN = false;

// send text message
function sendText() {
  let userName = document.getElementById('userName').value
  let message = userName + ": " + document.getElementById('textMsg').value;
  textChannel.send(message);
  processMessage(message);
  document.getElementById('textMsg').value = "";
}

// update html with the new messages
function processMessage(message) {
  var textBubble = document.createElement("div");
  textBubble.className = "container";
  var textLabel = document.createElement("label");
  textLabel.innerHTML = message;
  textBubble.appendChild(textLabel);
  document.getElementById("textMessages").appendChild(textBubble);
}

// initialize a new peer connection
async function initPeerConnection(roomsDB, collectionName) {
  let config = { iceServers: [{ urls: 'stun:stun1.l.google.com:19302'}] };

  if (useTURN) {
    const response = await fetch(TURN_API_KEY);
    const iceServers = await response.json();
    config = { iceServers: iceServers };
  }

  peerConnection = new RTCPeerConnection(config);

  // add the ICE candidates to firestore
  peerConnection.addEventListener('icecandidate', event => {
    if (event.candidate) {
      (roomsDB.collection(collectionName)).add(event.candidate.toJSON());
    }
  });

  // add the media tracks to peer connection
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  // listen for remote media track
  peerConnection.addEventListener('track', event => {
    event.streams[0].getTracks().forEach(track => {
      remoteStream.addTrack(track);
    });
  });
}

// update html when a room is created
function createRoomUI() {
  document.getElementById('createRoomButton').disabled = true;
  document.getElementById('joinRoomButton').disabled = true;
}

function disconnected() {
  if (!initializedHangup) {
    document.getElementById("disconnected").showModal();
  }
  hangUp();
}
// create a room and add the room id to firestore
async function createRoom() {
  createRoomUI();

  const roomsDB = await (firebase.firestore()).collection('rooms').doc();

  // initialize the RTCPeerConnection
  await initPeerConnection(roomsDB, "caller");

  // create the text channel
  textChannel = peerConnection.createDataChannel("text", { reliable: true, ordered: true});
  textChannel.onmessage = function (event) {
    processMessage(event.data);
  };

  // set local SDP
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  await roomsDB.set({'offer': {type: offer.type, sdp: offer.sdp}});
  document.getElementById('currentRoom').innerText = `RoomID: ${roomsDB.id}`;

  // Listening for remote session from DB
  roomsDB.onSnapshot(async snapshot => {
    const data = snapshot.data();
    if (!peerConnection.currentRemoteDescription && data && data.answer) {
      const rtcSessionDescription = new RTCSessionDescription(data.answer);
      await peerConnection.setRemoteDescription(rtcSessionDescription);
    }
  });

  // Listen for remote ICE candidates on db
  roomsDB.collection('callee').onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async change => {
      if (change.type == 'added') {
        let data = change.doc.data();
        await peerConnection.addIceCandidate(new RTCIceCandidate(data));
      }
      // the other side hang up
      else if (change.type == "removed") {
        disconnected();
      }
    });
  });

  roomId = roomsDB.id;
  localConnection = peerConnection;
}

// html update for joining a room
function joinRoom() {
  document.getElementById("room-id").value = '';
  document.getElementById('createRoomButton').disabled = true;
  document.getElementById('joinRoomButton').disabled = true;

  // pop up dialog for choosing room id
  const modal = document.querySelector("[data-modal]");

  document.getElementById('confirmJoinBtn').
    addEventListener('click', async () => {
      roomId = document.getElementById('room-id').value;
      document.getElementById('currentRoom').innerText = `RoomID: ${roomId}`;
      modal.close()
      await joinRoomById(roomId);
    }, { once: true });

  /* Join room modal/dialog */
  document.getElementById("cancelJoinBtn").addEventListener("click", async () => {
    document.getElementById('createRoomButton').disabled = false;
    document.getElementById('joinRoomButton').disabled = false;
    modal.close()
  });
  modal.showModal();
}

// connect to RTC session by roomId
async function joinRoomById(roomId) {
  const roomsDB = (firebase.firestore()).collection('rooms').doc(`${roomId}`);
  const roomSnapshot = await roomsDB.get();

  if (roomSnapshot.exists) {

    await initPeerConnection(roomsDB,"callee");

    peerConnection.ondatachannel = (event) => {
      textChannel = event.channel;
      textChannel.onmessage = function (event) {
        processMessage(event.data);
      }
    };

    // Set local and remote SDP 
    const offer = roomSnapshot.data().offer;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    await roomsDB.update({answer: {type: answer.type,sdp: answer.sdp}});

    // Listen for remote ICE 
    roomsDB.collection('caller').onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async change => {
        if (change.type == 'added') {
          let data = change.doc.data();
          await peerConnection.addIceCandidate(new RTCIceCandidate(data));
        }
        // the other side hang up
        else if (change.type == "removed") {
          disconnected();
        }
      });
    });
  }
  else {
    // room not exist
    document.getElementById("roomNotFoundText").innerHTML = `Room ${roomId} not found`;
    (document.querySelector("[roomNotFound]")).showModal();
    hangUp();
  }
}

async function openMedia() {
  initializedHangup = false;
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

  // Browser needs permission before displaying media devices, so auto refresh.
  navigator.mediaDevices.enumerateDevices().then(gotDevices).catch(handleError);

  document.getElementById('localVideo').srcObject = stream;
  localStream = stream;
  remoteStream = new MediaStream();
  document.getElementById('remoteVideo').srcObject = remoteStream;

  document.getElementById('openMediaButton').disabled = true;
  document.getElementById('createRoomButton').disabled = false;
  document.getElementById('joinRoomButton').disabled = false;
  document.getElementById('hangUpButton').disabled = false;
}


function hangUPUI() {
  document.getElementById('localVideo').srcObject = null;
  document.getElementById('remoteVideo').srcObject = null;
  document.getElementById('openMediaButton').disabled = false;
  document.getElementById('createRoomButton').disabled = true;
  document.getElementById('joinRoomButton').disabled = true;
  document.getElementById('hangUpButton').disabled = true;
  document.getElementById('currentRoom').innerText = '';
  document.getElementById('textMessages').textContent = '';
}

async function deleteRoom() {
  // Delete room on hangup
  if (roomId) {
    const roomsDB = (firebase.firestore()).collection('rooms').doc(roomId);
    const callee = await roomsDB.collection('callee').get();
    callee.forEach(async candidate => {
      await candidate.ref.delete();
    });
    const caller = await roomsDB.collection('caller').get();
    caller.forEach(async candidate => {
      await candidate.ref.delete();
    });
    await roomsDB.delete();
  }
}

async function hangUp() {
  initializedHangup = true;
  const tracks = document.getElementById('localVideo').srcObject.getTracks();
  tracks.forEach(track => {
    track.stop();
  });

  if (remoteStream) {
    remoteStream.getTracks().forEach(track => track.stop());
  }

  if (peerConnection) {
    peerConnection.close();
  }

  await deleteRoom();

  hangUPUI();

}

/* ########################################################################## */

/* Select sources & outputs. I.e., choose from available camera(s), microphone(s), and speaker(s) */
const localVideoElement = document.getElementById("localVideo");
const audioInputSelect = document.querySelector("select#audioSource");
const audioOutputSelect = document.querySelector("select#audioOutput");
const videoSelect = document.querySelector("select#videoSource");
const selectors = [audioInputSelect, audioOutputSelect, videoSelect];

function gotDevices(deviceInfos) {

  // This will handle being called several times when updating options. Preserve values.
  const values = selectors.map(select => select.value);
  selectors.forEach(select => {
    while (select.firstChild) {
      select.removeChild(select.firstChild);
    }
  });

  for (let i = 0; i < deviceInfos.length; i++) {
    const deviceInfo = deviceInfos[i];
    const option = document.createElement("option");
    option.value = deviceInfo.deviceId;

    if (deviceInfo.kind === "audioinput") {
      option.text = deviceInfo.label || `microphone ${audioInputSelect.length + 1} (check permissions)`;
      audioInputSelect.appendChild(option);
    }
    else if (deviceInfo.kind === "audiooutput") {
      option.text = deviceInfo.label || `speaker ${audioOutputSelect.length + 1} (check permissions)`;
      audioOutputSelect.appendChild(option);
    }
    else if (deviceInfo.kind === "videoinput") {
      option.text = deviceInfo.label || `camera ${videoSelect.length + 1} (check permissions)`;
      videoSelect.appendChild(option);
    }
    else {
      console.log("Some other kind of source/device: ", deviceInfo);
    }
  }

  selectors.forEach((select, selectorIndex) => {
    if (Array.prototype.slice.call(select.childNodes).some(n => n.value === values[selectorIndex])) {
      select.value = values[selectorIndex];
    }
  });
}

function handleError(error) {
  console.log("navigator.MediaDevices.getUserMedia error: ", error.message, error.name);
}

/* navigator.mediaDevices.enumerateDevices() will return a promise that resolves to an array of
  MediaDevicesInfo that describe each known media device. */
navigator.mediaDevices.enumerateDevices().then(gotDevices).catch(handleError);

/* Attach audio output device to video element using device/sink ID. */
function attachSinkId(element, sinkId) {
  if (typeof element.sinkId === "undefined") {
    console.warn("Browser does not support output device selection.");
    return;
  }
  element.setSinkId(sinkId)
    .then(() => {
      console.log(`Success, audio output device attached: ${sinkId}`);
    })
    .catch(error => {
      let errorMessage = error;
      if (error.name === "SecurityError") {
        errorMessage = `You need to use HTTPS for selecting audio output device: ${error}`;
      }
      console.error(errorMessage);
      // Jump back to first output device in the list as it's the default.
      audioOutputSelect.selectedIndex = 0;
    });
}

function changeAudioDestination() {
  const audioDestination = audioOutputSelect.value;
  attachSinkId(localVideoElement, audioDestination);
}

function gotStream(stream) {
  localStream = stream; // make stream available to console
  localVideoElement.srcObject = stream;
  return navigator.mediaDevices.enumerateDevices(); // Refresh list of available devices
}

function restartTracks() {
  if (localStream) {
    localStream.getTracks().forEach(track => {
      track.stop();
    });
  }
  const audioSource = audioInputSelect.value;
  const videoSource = videoSelect.value;
  const constraints = {
    audio: { deviceId: audioSource ? { exact: audioSource } : undefined },
    video: { deviceId: videoSource ? { exact: videoSource } : undefined }
  };
  navigator.mediaDevices.getUserMedia(constraints).then(gotStream).then(gotDevices).catch(handleError);
}

function switchTracks() {
  if (!peerConnection) {
    restartTracks();
    return;
  }
  connections = [peerConnection];
  const audioSource = audioInputSelect.value;
  const videoSource = videoSelect.value;
  navigator.mediaDevices
    .getUserMedia({
      audio: { deviceId: audioSource ? { exact: audioSource } : undefined },
      video: { deviceId: videoSource ? { exact: videoSource } : undefined }
    })
    .then((stream) => {
      const [videoTrack] = stream.getVideoTracks();
      const [audioTrack] = stream.getAudioTracks();
      connections.forEach((pc) => {
        const videoSender = pc
          .getSenders()
          .find((s) => s.track.kind === videoTrack.kind);
        console.log("Found video sender:", videoSender);
        videoSender.replaceTrack(videoTrack);

        const audioSender = pc
          .getSenders()
          .find((s) => s.track.kind === audioTrack.kind);
        console.log("Found audio sender:", audioSender);
        audioSender.replaceTrack(audioTrack);

        localStream = stream; // make stream available to console
        localVideoElement.srcObject = stream;
      });
    })
    .catch((err) => {
      console.error(`Error happened: ${err}`);
    });

  // Refresh list of available devices
  navigator.mediaDevices.enumerateDevices().then(gotDevices).catch(handleError);
}

/* The sinkId property is part of the Web Audio API and allows developers to select the output 
  device for audio. */
audioOutputSelect.disabled = !("sinkId" in HTMLMediaElement.prototype);

audioInputSelect.onchange = switchTracks;
audioOutputSelect.onchange = changeAudioDestination;

videoSelect.onchange = switchTracks;