

let peerConnection = null;
let roomId = null;
let textChannel = null;
let initializedHangup = false;
let expectedSize = -1;
let imgChannel = null;
let expectedSizeChannel = null;
let receiveBuffer = [];
let receivedSize = 0;

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

function processImgChannel(event) {
  receiveBuffer.push(event.data);
  receivedSize += event.data.byteLength;
  console.log(receivedSize);

  if (receivedSize == expectedSize) {
    let reader = new FileReader();
    reader.onload = function (e) {
      processImg(e.target.result);
    }

    const received = new Blob(receiveBuffer);

    processImg(URL.createObjectURL(received));
    receivedSize = 0;
    expectedSize = -1;
    receiveBuffer = [];
  }


}

function sendImage() {
  if (document.getElementById("imageText").files && document.getElementById("imageText").files[0]) {
    let file = document.getElementById("imageText").files[0];

    expectedSizeChannel.send(file.size)
    // send the date over
    let reader = new FileReader();
    let offset = 0;
    const chunkSize = 16384;
    reader.onload = function (e) {
      imgChannel.send(e.target.result);
      offset += e.target.result.byteLength;
      if (offset < file.size) {
        readSlice(offset);
      }
    }

    const readSlice = o => {
      const slice = file.slice(offset, o + chunkSize);
      reader.readAsArrayBuffer(slice);
    };
    document.getElementById('imageText').value = "";
    readSlice(0);

    // show on local
    let reader1 = new FileReader();
    reader1.onload = function (e) {
      processImg(e.target.result);
    }
    reader1.readAsDataURL(file);
  }
}

function processImg(file) {
  var textBubble = document.createElement("div");
  textBubble.className = "container";
  var imgEle = document.createElement("img");

  imgEle.src = file;
  imgEle.className = "textChatImage";

  textBubble.appendChild(imgEle);
  document.getElementById("textMessages").appendChild(textBubble);

}

// initialize a new peer connection
async function initPeerConnection(roomsDB, collectionName) {
  let config = { iceServers: [{ urls: 'stun:stun1.l.google.com:19302' }] };

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
  localVideoElement.srcObject.getTracks().forEach(track => {
    peerConnection.addTrack(track, localVideoElement.srcObject);
  });

  // listen for remote media track
  peerConnection.addEventListener('track', event => {
    console.log('> remote track:', event.streams[0]);
    event.streams[0].getTracks().forEach(track => {
      document.getElementById('remoteVideo').srcObject.addTrack(track);
    });
  });

  // set up data channels (text and images)
  if (collectionName == "caller") {
    // create the text channel
    textChannel = peerConnection.createDataChannel("text", { reliable: true, ordered: true });
    textChannel.onmessage = function (event) {
      processMessage(event.data);
    };

    // image Channel
    imgChannel = peerConnection.createDataChannel("img", { reliable: true, ordered: true });
    imgChannel.onmessage = function (event) {
      processImgChannel(event);
    };

    // use to send the expected size for the image coming from the img channel
    expectedSizeChannel = peerConnection.createDataChannel("expectedSize", { reliable: true, ordered: true });
    expectedSizeChannel.onmessage = function (event) {
      expectedSize = event.data;
    }
  }
  // callee
  else {
    peerConnection.ondatachannel = (event) => {
      if (event.channel.label == "text") {
        textChannel = event.channel;
        textChannel.onmessage = function (event) {
          processMessage(event.data);
        }
      }
      else if (event.channel.label == "img") {
        imgChannel = event.channel;
        imgChannel.onmessage = function (event) {
          processImgChannel(event);
        }
      }
      else if (event.channel.label == "expectedSize") {
        expectedSizeChannel = event.channel
        expectedSizeChannel.onmessage = function (event) {
          expectedSize = event.data;
        }
      }
    };
  }
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


  // set local SDP
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  await roomsDB.set({ 'offer': { type: offer.type, sdp: offer.sdp } });
  document.getElementById('currentRoom').innerText = `Room ID: ${roomsDB.id}`;

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

    await initPeerConnection(roomsDB, "callee");

    // Set local and remote SDP 
    const offer = roomSnapshot.data().offer;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    await roomsDB.update({ answer: { type: answer.type, sdp: answer.sdp } });

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

  localVideoElement.srcObject = stream;

  restartTracks(); // Update to latest selection of media devices

  document.getElementById('remoteVideo').srcObject = new MediaStream();

  document.getElementById('openMediaButton').disabled = true;
  document.getElementById('createRoomButton').disabled = false;
  document.getElementById('joinRoomButton').disabled = false;
  document.getElementById('hangUpButton').disabled = false;
}


function hangUPUI() {
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

  // removeTracks(); // do before stopping tracks? browsers inconsistent
  if (localVideoElement.srcObject) {
    localVideoElement.srcObject.getTracks().forEach(track => {
      track.stop();
    });
  }
  localVideoElement.srcObject = null;

  if (document.getElementById('remoteVideo').srcObject) {
    document.getElementById('remoteVideo').srcObject.getTracks().forEach(track => track.stop());
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
      option.text = deviceInfo.label || `Microphone ${audioInputSelect.length + 1} (check permissions)`;
      audioInputSelect.appendChild(option);
    }
    else if (deviceInfo.kind === "audiooutput") {
      option.text = deviceInfo.label || `Speaker ${audioOutputSelect.length + 1} (check permissions)`;
      audioOutputSelect.appendChild(option);
    }
    else if (deviceInfo.kind === "videoinput") {
      option.text = deviceInfo.label || `Camera ${videoSelect.length + 1} (check permissions)`;
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
  localVideoElement.srcObject = stream;
  return navigator.mediaDevices.enumerateDevices(); // Refresh list of available devices
}

function restartTracks() {
  if (!localVideoElement.srcObject) {
    return;
  }
  localVideoElement.srcObject.getTracks().forEach(track => {
    track.stop();
  });
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
    // state: if local media is open but there is no peer connection
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
        // console.log(`videoTrack.kind ${videoTrack.kind}`); // debug

        const audioSender = pc
          .getSenders()
          .find((s) => s.track.kind === audioTrack.kind);
        console.log("Found audio sender:", audioSender);
        audioSender.replaceTrack(audioTrack);
        // console.log(`audioTrack.kind ${audioTrack.kind}`); // debug

        localVideoElement.srcObject = stream;
      });
    })
    .catch((err) => {
      console.error(`Error happened: ${err}`);
    });

  // Refresh list of available devices
  navigator.mediaDevices.enumerateDevices().then(gotDevices).catch(handleError);
}

function removeTracks() {
  // Must have initialized hangup and peer connection still exists
  if (!initializedHangup || !peerConnection) {
    return;
  }
  peerConnection.getSenders().forEach((sender) => sender.replaceTrack(null));
}

/* The sinkId property is part of the Web Audio API and allows developers to select the output 
  device for audio. */
audioOutputSelect.disabled = !("sinkId" in HTMLMediaElement.prototype);

audioInputSelect.onchange = switchTracks;
audioOutputSelect.onchange = changeAudioDestination;

videoSelect.onchange = switchTracks;