let timeLeft = 60;
let correctAnswer = "";

window.onload = async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const level = urlParams.get('level');

    const res = await fetch(`/game/get-question/${level}`);
    const data = await res.json();

    if (data.success) {
        document.getElementById('questionText').innerText = data.question.question_text;
        document.getElementById('explanationText').innerText = data.question.explanation;

        const optionsGrid = document.querySelector('.options-grid');
        optionsGrid.innerHTML = '';

        data.choices.forEach(choice => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.innerText = choice.choice_text;

            btn.onclick = () => checkAnswer(choice.is_answer, btn);

            optionsGrid.appendChild(btn);
        });

        startTimer();
    }
};

function checkAnswer(isCorrect, clickedBtn) {
    const btns = document.querySelectorAll('.option-btn');
    btns.forEach(b => b.disabled = true);

    if (isCorrect) {
        clickedBtn.style.backgroundColor = "#2ecc71";
        clickedBtn.style.color = "white";
        alert("✨ CORRECT! Well done.");
    } else {
        clickedBtn.style.backgroundColor = "#e74c3c";
        clickedBtn.style.color = "white";
        alert("WRONG! Better luck next time.");
    }

    document.getElementById('explanationBox').style.display = 'block';
}

function startTimer() {
    const timerEl = document.getElementById('timer');
    const interval = setInterval(() => {
        timeLeft--;
        timerEl.innerText = timeLeft;
        if (timeLeft <= 0) {
            clearInterval(interval);
            alert("TIME OUT!");
            finishChallenge(false);
        }
    }, 1000);
}

function finishChallenge() {
    window.location.href = `/game/player-dashboard/${SESSION_ID}`;
}