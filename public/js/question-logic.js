let questionQueue = [];
let currentIdx = 0;

async function init() {
    try {
        const params = new URLSearchParams(window.location.search);
        const level = params.get('level') || 'Easy';

        let count = params.get('count');
        if (!count) {
            count = (MODE === 'ROUND') ? 3 : 1;
        }

        console.log(`Loading ${count} questions for ${level} mode...`);

        const response = await fetch(`/get-questions?level=${level}&count=${count}`);

        if (!response.ok) throw new Error("Server error: " + response.status);

        const data = await response.json();
        console.log("📦 Received Data:", data);

        if (data.success && data.questions && data.questions.length > 0) {
            questionQueue = data.questions;
            loadQuestion(0);
        } else {
            document.getElementById('questionText').innerText = "ERROR: " + (data.message || "No questions found");
        }
    } catch (err) {
        console.error("❌ Failed to load questions:", err);
        document.getElementById('questionText').innerText = "Connection Failed: Check F12 Console.";
    }
}

function loadQuestion(idx) {
    console.log("Loading index:", idx, "Question data:", questionQueue[idx]);
    if (!questionQueue[idx]) return finishAll();

    const q = questionQueue[idx];
    document.getElementById('questionText').innerText = q.question_text;
    document.getElementById('levelBadge').innerText = `${LEVEL.toUpperCase()} (${idx + 1}/${questionQueue.length})`;

    const btns = document.querySelectorAll('.option-btn');

    if (!q.choices || !Array.isArray(q.choices)) {
        console.error("Choices missing for:", q.question_id);
        return;
    }

    btns.forEach((btn, i) => {
        const choice = q.choices[i];
        if (choice) {
            btn.style.display = 'block';
            btn.innerText = choice.choice_text;
            btn.className = 'option-btn';
            btn.disabled = false;
            btn.onclick = () => handleAnswer(btn, choice.choice_id, choice.is_answer, q);
        } else {
            btn.style.display = 'none';
        }
    });
}

async function handleAnswer(selectedBtn, choiceId, isCorrect, currentQuestion) {
    const btns = document.querySelectorAll('.option-btn');
    btns.forEach(btn => btn.disabled = true);

    if (isCorrect) {
        selectedBtn.classList.add('correct');
    } else {
        selectedBtn.classList.add('wrong');
        btns.forEach((btn, i) => {
            if (currentQuestion.choices[i].is_answer) btn.classList.add('correct');
        });
    }

    const expBox = document.getElementById('explanationBox');
    if (expBox) {
        expBox.style.display = 'block';
        document.getElementById('explanationText').innerText = currentQuestion.explanation;
    }

    try {
        const urlParams = new URLSearchParams(window.location.search);
        const cellCode = urlParams.get('cell') || '';

        const response = await fetch('/submit-attempt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                playerId: PLAYER_ID,
                sessionId: SESSION_ID,
                questionId: currentQuestion.question_id,
                selectedChoiceId: choiceId,
                isCorrect: isCorrect,
                mode: MODE,
                level: LEVEL,
                cellCode: cellCode
            })
        });

        const result = await response.json();

        if (result.success && result.correct) {

            if (result.message && result.message.includes("already been looted")) {
                if (typeof showModal === 'function') {
                    await showModal("EMPTY CHEST", "You found the spot, but the treasure was already taken!");
                }
            }
            else if (result.itemsEarned && result.itemsEarned.length > 0) {
                const item = result.itemsEarned[0];

                document.getElementById('treasure-name').innerText = item.name;
                document.getElementById('treasure-value').innerText = item.value;

                const iconEl = document.getElementById('treasure-icon');
                if (iconEl) {
                    if (item.name.includes('Movement')) iconEl.className = "fas fa-boot";
                    else if (item.name.includes('Verify')) iconEl.className = "fas fa-check-double";
                    else if (item.name.includes('Swap')) iconEl.className = "fas fa-exchange-alt";
                    else iconEl.className = "fas fa-scroll";
                }

                const treasureModal = document.getElementById('treasure-modal');
                if (treasureModal) treasureModal.style.display = 'flex';
            }
        }
    } catch (err) {
        console.error("Reward Submission Failed:", err);
    }

    const nextBtn = document.querySelector('.btn-continue');
    if (nextBtn) {
        nextBtn.innerText = (currentIdx === questionQueue.length - 1) ? "FINISH & CLOSE" : "NEXT QUESTION";
    }
}

function closeTreasure() {
    const treasureModal = document.getElementById('treasure-modal');
    if (treasureModal) treasureModal.style.display = 'none';
}

function nextStep() {
    currentIdx++;
    if (currentIdx < questionQueue.length) {
        loadQuestion(currentIdx);
    } else {
        finishAll();
    }
}

function finishAll() {
    console.log("Redirecting to session:", SESSION_ID);

    if (SESSION_ID && SESSION_ID !== "undefined") {
        window.location.href = `/game-start-player/${SESSION_ID}`;
    } else {
        console.error("SESSION_ID is missing! Falling back to home.");
        window.location.href = "/";
    }
}

window.onload = init;