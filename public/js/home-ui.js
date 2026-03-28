document.addEventListener('DOMContentLoaded', () => {
    const username = document.querySelector('.user-name')?.innerText || "";
    console.log("HOME-UI: Script Loaded and Ready");

    const createModal = document.getElementById('createModal');
    const joinModal = document.getElementById('joinModal');
    const recoveryModal = document.getElementById('recoveryModal');
    const hostDisplayID = document.getElementById('hostDisplayID');

    const createBtn = document.querySelector('.hero-box .btn-pill:nth-of-type(2)');
    const joinBtn = document.querySelector('.hero-box .btn-pill:nth-of-type(1)');

    const confirmCreateBtn = document.getElementById('confirmCreate');
    const startNewBtn = document.getElementById('startNewSession');
    const continueBtn = document.getElementById('continueSession');
    const confirmJoinBtn = document.getElementById('confirmJoin');

    const getEl = (id) => document.getElementById(id) || { style: {}, onclick: null };

    const avatar = document.querySelector('.avatar-wrapper');
    if (avatar) {
        avatar.addEventListener('click', (e) => {
            const tooltip = avatar.querySelector('.account-tooltip');
            if (tooltip) {
                tooltip.style.visibility = (tooltip.style.visibility === 'visible') ? 'hidden' : 'visible';
                tooltip.style.opacity = (tooltip.style.opacity === '1') ? '0' : '1';
                tooltip.style.pointerEvents = (tooltip.style.pointerEvents === 'auto') ? 'none' : 'auto';
            }
        });
    }

    const startScanBtn = document.getElementById('startScan');
    const readerDiv = document.getElementById('reader');

    const userStatusEl = document.getElementById('userStatus');
    const isLoggedIn = userStatusEl && userStatusEl.getAttribute('data-logged-in') === 'true';

    let activeRoomCode = "";

    const urlParams = new URLSearchParams(window.location.search);
    const quickJoinCode = urlParams.get('joinCode');

    if (quickJoinCode) {
        if (!isLoggedIn) {
            alert("Please sign in first!");
            window.location.href = '/login';
        } else {
            let playerName = localStorage.getItem('lastPlayerName') || username;

            if (!playerName) {
                joinModal.classList.remove('hidden');
                document.getElementById('sessionCode').value = quickJoinCode.toUpperCase();
            } else {
                autoJoinSession(playerName, quickJoinCode.toUpperCase());
                window.history.replaceState({}, document.title, window.location.pathname);
            }
        }
    }

    async function autoJoinSession(playerName, code) {
        try {
            console.log(`Attempting join for ${playerName} in room ${code}`);

            const response = await fetch('/join-session', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'ngrok-skip-browser-warning': 'true'
                },
                body: JSON.stringify({ playerName, accessCode: code })
            });

            const data = await response.json();

            if (data.success) {
                console.log("Join successful, redirecting...");
                window.history.replaceState({}, document.title, window.location.pathname);
                window.location.href = `/session-player/${code}`;
            } else {
                alert("Join Error: " + data.message);
            }
        } catch (err) {
            console.error("Fetch Error:", err);
            alert("Connection failed. Please ensure you are using HTTPS.");
        }
    }

    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    async function openCreateSetup() {
        console.log("Action: Fetching ID and Opening Setup Modal");
        try {
            const response = await fetch('/get-next-host-id');
            const data = await response.json();
            if (hostDisplayID) {
                hostDisplayID.value = data.nextHostId || "H0001";
            }
        } catch (err) {
            console.warn("Fetch ID failed, using default H0001");
            if (hostDisplayID) hostDisplayID.value = "H0001";
        }

        if (recoveryModal) recoveryModal.classList.add('hidden');
        if (createModal) createModal.classList.remove('hidden');
    }

    if (createBtn) {
        createBtn.onclick = async () => {
            if (!isLoggedIn) {
                alert("Please sign in first before create session!");
                window.location.href = '/login';
                return;
            }
            try {
                const res = await fetch('/check-active-session');
                const data = await res.json();
                if (data.hasActive) {
                    activeRoomCode = data.code;
                    recoveryModal.classList.remove('hidden');
                } else {
                    await openCreateSetup();
                }
            } catch (err) {
                await openCreateSetup();
            }
        };
    }

    if (startNewBtn) {
        startNewBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log("Action: Starting New Session (Manual Override)");

            if (recoveryModal) recoveryModal.classList.add('hidden');
            await openCreateSetup();
        });
    }

    if (continueBtn) {
        continueBtn.onclick = () => {
            if (activeRoomCode) {
                window.location.href = `/game-start/${activeRoomCode}`;
            }
        };
    }

    if (confirmCreateBtn) {
        confirmCreateBtn.onclick = async () => {
            const maxPlayers = document.getElementById('maxPlayers').value;
            try {
                const response = await fetch('/create-session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ maxPlayers: parseInt(maxPlayers) })
                });
                const data = await response.json();
                if (data.success && data.code) {
                    window.location.href = `/session-host/${data.code}`;
                } else {
                    alert("Failed: " + (data.message || "Error"));
                }
            } catch (err) {
                alert("Network Error during creation");
            }
        };
    }

    if (joinBtn) {
        joinBtn.onclick = () => {
            if (!isLoggedIn) {
                alert("Please sign in first before join session!");
                window.location.href = '/login';
                return;
            }

            joinModal.classList.remove('hidden');

            if (isMobile && startScanBtn) {
                startScanBtn.style.display = 'block';
            }
        };
    }

    if (startScanBtn) {
        startScanBtn.onclick = () => {
            if (typeof Html5Qrcode === 'undefined') {
                alert("QR Library missing!");
                return;
            }

            if (readerDiv) {
                readerDiv.style.display = 'block';
                readerDiv.style.border = "3px solid #D8B56A";
            }

            const html5QrCode = new Html5Qrcode("reader");

            // 1. Define the Scan Success Logic
            const onScanSuccess = (decodedText) => {
                console.log("Scanned:", decodedText);
                let code = decodedText.includes('joinCode=') ?
                    decodedText.split('joinCode=')[1].substring(0, 6) :
                    decodedText.trim().substring(0, 6);

                const finalCode = code.toUpperCase();
                document.getElementById('sessionCode').value = finalCode;

                html5QrCode.stop().then(() => {
                    readerDiv.style.display = 'none';
                    const playerName = document.getElementById('playerName').value.trim();
                    if (playerName) {
                        autoJoinSession(playerName, finalCode);
                    } else {
                        alert("Room " + finalCode + " detected! Enter your name.");
                        document.getElementById('playerName').focus();
                    }
                });
            };

            const config = { fps: 30, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 };

            // 2. THE FIX: Try "Smart" detection first, then Fallback to "Hard-coded" back camera
            Html5Qrcode.getCameras().then(devices => {
                if (devices && devices.length > 0) {
                    // Look for "back" or "rear". If not found, pick the LAST one in the list.
                    const backCamera = devices.find(d => /back|rear|environment/i.test(d.label));
                    const cameraId = backCamera ? backCamera.id : devices[devices.length - 1].id;

                    html5QrCode.start(cameraId, config, onScanSuccess)
                        .catch(err => {
                            console.warn("ID Start failed, trying generic environment mode...", err);
                            // Final Fallback: The standard environment string
                            html5QrCode.start({ facingMode: "environment" }, config, onScanSuccess);
                        });
                } else {
                    // If no devices listed, try the standard string immediately
                    html5QrCode.start({ facingMode: "environment" }, config, onScanSuccess);
                }
            }).catch(() => {
                // If getCameras is blocked, use the standard string
                html5QrCode.start({ facingMode: "environment" }, config, onScanSuccess);
            });
        };
    }

    if (confirmJoinBtn) {
        confirmJoinBtn.onclick = async () => {
            const playerName = document.getElementById('playerName').value;
            const sessionCode = document.getElementById('sessionCode').value.toUpperCase();

            localStorage.setItem('lastPlayerName', playerName);

            if (!playerName || !sessionCode) {
                alert("Please enter Name and Code");
                return;
            }
            if (!sessionCode || sessionCode.length !== 6) {
                alert("Please enter a valid 6-digit Room Code!");
                return;
            }

            try {
                const response = await fetch('/join-session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ playerName, accessCode: sessionCode })
                });

                const data = await response.json();

                if (data.success) {
                    console.log("Join successful! Redirecting to player dashboard...");
                    window.location.href = `/session-player/${sessionCode}`;
                } else {
                    alert(data.message || "Join failed");

                    if (data.message && data.message.includes("sign in")) {
                        window.location.href = '/login';
                    }
                }
            } catch (err) {
                console.error("Join error:", err);
                alert("Network error. Please try again.");
            }
        };
    }

    const closeButtons = document.querySelectorAll('#closeModal, #closeCreateModal, .btn-cancel');
    closeButtons.forEach(btn => {
        btn.onclick = () => {
            console.log("Closing all modals");
            if (createModal) createModal.classList.add('hidden');
            if (joinModal) joinModal.classList.add('hidden');
            if (recoveryModal) recoveryModal.classList.add('hidden');
            if (readerDiv) readerDiv.style.display = 'none';
        };
    });
});