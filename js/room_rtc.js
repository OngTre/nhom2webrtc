const APP_ID = "a346e253bbbf4c229e4eadd4f7b4985f"

let uid = sessionStorage.getItem('uid');
if (!uid) {
    uid = String(Math.floor(Math.random() * 10000));
    sessionStorage.setItem('uid', uid);
}

let token = null;
let client;
let rtmClient;
let channel;
let mediaRecorder;
let recordedChunks = [];

const queryString = window.location.search;
const urlParams = new URLSearchParams(queryString);
let roomId = urlParams.get('room') || 'main'; // Default to 'main' if no roomId found

let displayName = sessionStorage.getItem('display_name');
if (!displayName) {
    window.location = 'lobby.html';
}

let localTracks = [];
let remoteUsers = {};
let localScreenTracks;
let sharingScreen = false;

let joinRoomInit = async () => {
    rtmClient = await AgoraRTM.createInstance(APP_ID);
    await rtmClient.login({ uid, token });

    await rtmClient.addOrUpdateLocalUserAttributes({ 'name': displayName });

    channel = await rtmClient.createChannel(roomId);
    await channel.join();

    channel.on('MemberJoined', handleMemberJoined);
    channel.on('MemberLeft', handleMemberLeft);
    channel.on('ChannelMessage', handleChannelMessage);

    getMembers();
    addBotMessageToDom(`Welcome to the room ${displayName}! 👋`);

    client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
    await client.join(APP_ID, roomId, token, uid);

    client.on('user-published', handleUserPublished);
    client.on('user-left', handleUserLeft);
};

let joinStream = async () => {
    document.getElementById('join-btn').style.display = 'none';
    document.getElementsByClassName('stream__actions')[0].style.display = 'flex';

    localTracks = await AgoraRTC.createMicrophoneAndCameraTracks({}, {
        encoderConfig: {
            width: { min: 640, ideal: 1920, max: 1920 },
            height: { min: 480, ideal: 1080, max: 1080 }
        }
    });

    let player = `<div class="video__container" id="user-container-${uid}">
                    <div class="video-player" id="user-${uid}"></div>
                 </div>`;

    document.getElementById('streams__container').insertAdjacentHTML('beforeend', player);
    document.getElementById(`user-container-${uid}`).addEventListener('click', expandVideoFrame);

    localTracks[1].play(`user-${uid}`);
    await client.publish([localTracks[0], localTracks[1]]);
};

const toggleRecording = async (e) => {
    try {
        const button = e.currentTarget;
        const statusElement = document.getElementById('record-status');

        // Kiểm tra xem MediaRecorder có được hỗ trợ không
        if (typeof MediaRecorder === 'undefined') {
            console.error('MediaRecorder is not supported in this browser');
            alert('Trình duyệt của bạn không hỗ trợ ghi hình. Vui lòng sử dụng trình duyệt khác.');
            return;
        }

        // Kiểm tra quyền truy cập màn hình
        if (!await checkScreenPermissions()) {
            console.error('Permissions not granted');
            alert('Vui lòng cấp quyền truy cập màn hình để ghi hình.');
            return;
        }

        // Tạo MediaStream từ màn hình
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });

        // Nếu mediaRecorder chưa được khởi tạo hoặc đang ở trạng thái 'inactive'
        if (!mediaRecorder || mediaRecorder.state === 'inactive') {
            recordedChunks = [];

            mediaRecorder = new MediaRecorder(screenStream, { mimeType: 'video/mp4' });

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    recordedChunks.push(event.data);
                }
            };

            mediaRecorder.start();
            button.classList.add('recording');
            statusElement.style.display = 'inline';
            console.log('Recording started');

            mediaRecorder.onstop = () => {
                const blob = new Blob(recordedChunks, { type: 'video/mp4' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = `recording_${Date.now()}.mp4`;
                document.body.appendChild(a);
                a.click();
                URL.revokeObjectURL(url);
                console.log('Recording stopped, file saved');
            };

        } else if (mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
            button.classList.remove('recording');
            statusElement.style.display = 'none';
            console.log('Recording stopped');
        }
    } catch (error) {
        console.error('Error in toggleRecording:', error);
        alert('Đã xảy ra lỗi khi cố gắng ghi hình. Vui lòng kiểm tra console để biết chi tiết.');
    }
};

async function checkScreenPermissions() {
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia();
        stream.getTracks().forEach(track => track.stop());
        return true;
    } catch (error) {
        console.error('Error checking screen permissions:', error);
        return false;
    }
}
async function checkScreenPermissions() {
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia();
        stream.getTracks().forEach(track => track.stop());
        return true;
    } catch (error) {
        console.error('Error checking screen permissions:', error);
        return false;
    }
}

let switchToCamera = async () => {
    let player = `<div class="video__container" id="user-container-${uid}">
                    <div class="video-player" id="user-${uid}"></div>
                 </div>`;
    displayFrame.insertAdjacentHTML('beforeend', player);

    await localTracks[0].setMuted(true);
    await localTracks[1].setMuted(true);

    document.getElementById('mic-btn').classList.remove('active');
    document.getElementById('screen-btn').classList.remove('active');

    localTracks[1].play(`user-${uid}`);
    await client.publish([localTracks[1]]);
};

let handleUserPublished = async (user, mediaType) => {
    remoteUsers[user.uid] = user;

    await client.subscribe(user, mediaType);

    let player = document.getElementById(`user-container-${user.uid}`);
    if (player === null) {
        player = `<div class="video__container" id="user-container-${user.uid}">
                <div class="video-player" id="user-${user.uid}"></div>
            </div>`;

        document.getElementById('streams__container').insertAdjacentHTML('beforeend', player);
        document.getElementById(`user-container-${user.uid}`).addEventListener('click', expandVideoFrame);
    }

    if (mediaType === 'video') {
        user.videoTrack.play(`user-${user.uid}`);
    }

    if (mediaType === 'audio') {
        user.audioTrack.play();
    }
};

let handleUserLeft = async (user) => {
    delete remoteUsers[user.uid];
    let item = document.getElementById(`user-container-${user.uid}`);
    if (item) {
        item.remove();
    }
};

let toggleMic = async (e) => {
    let button = e.currentTarget;

    if (localTracks[0].muted) {
        await localTracks[0].setMuted(false);
        button.classList.add('active');
    } else {
        await localTracks[0].setMuted(true);
        button.classList.remove('active');
    }
};

let toggleCamera = async (e) => {
    let button = e.currentTarget;

    if (localTracks[1].muted) {
        await localTracks[1].setMuted(false);
        button.classList.add('active');
    } else {
        await localTracks[1].setMuted(true);
        button.classList.remove('active');
    }
};

let toggleScreen = async (e) => {
    let screenButton = e.currentTarget;
    let cameraButton = document.getElementById('camera-btn');

    if (!sharingScreen) {
        sharingScreen = true;

        screenButton.classList.add('active');
        cameraButton.classList.remove('active');
        cameraButton.style.display = 'none';

        localScreenTracks = await AgoraRTC.createScreenVideoTrack();

        document.getElementById(`user-container-${uid}`).remove();
        displayFrame.style.display = 'block';

        let player = `<div class="video__container" id="user-container-${uid}">
                <div class="video-player" id="user-${uid}"></div>
            </div>`;

        displayFrame.insertAdjacentHTML('beforeend', player);
        document.getElementById(`user-container-${uid}`).addEventListener('click', expandVideoFrame);

        localScreenTracks.play(`user-${uid}`);

        await client.unpublish([localTracks[1]]);
        await client.publish([localScreenTracks]);
    } else {
        sharingScreen = false;
        cameraButton.style.display = 'block';
        document.getElementById(`user-container-${uid}`).remove();
        await client.unpublish([localScreenTracks]);

        switchToCamera();
    }
};

let leaveStream = async (e) => {
    e.preventDefault();

    document.getElementById('join-btn').style.display = 'block';
    document.getElementsByClassName('stream__actions')[0].style.display = 'none';

    for (let i = 0; i < localTracks.length; i++) {
        localTracks[i].stop();
        localTracks[i].close();
    }

    await client.unpublish([localTracks[0], localTracks[1]]);

    if (localScreenTracks) {
        await client.unpublish([localScreenTracks]);
    }

    document.getElementById(`user-container-${uid}`).remove();
    channel.sendMessage({ text: JSON.stringify({ 'type': 'user_left', 'uid': uid }) });
};

// Gán sự kiện cho các nút
document.getElementById('record-btn').addEventListener('click', toggleRecording);
document.getElementById('camera-btn').addEventListener('click', toggleCamera);
document.getElementById('mic-btn').addEventListener('click', toggleMic);
document.getElementById('screen-btn').addEventListener('click', toggleScreen);
document.getElementById('join-btn').addEventListener('click', joinStream);
document.getElementById('leave-btn').addEventListener('click', leaveStream);

// Khởi tạo phòng
joinRoomInit();
