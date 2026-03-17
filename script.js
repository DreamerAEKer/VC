// DOM Elements
const transcriptEl = document.getElementById('transcript');
const resultEl = document.getElementById('result');
const mathPreviewEl = document.getElementById('math-preview');
const startBtn = document.getElementById('start-btn');
const resetBtn = document.getElementById('reset-btn');
const statusText = document.getElementById('status-text');
const indicator = document.querySelector('.display-card');
const delayProgress = document.getElementById('delay-progress');
const delayInput = document.getElementById('delay-input');
const historyList = document.getElementById('history-list');
const toggleHistory = document.getElementById('toggle-history');
const toggleSettings = document.getElementById('toggle-settings');

// State Manager
let state = {
    isListening: false,
    delay: parseFloat(localStorage.getItem('vcalc_delay')) || 1.5,
    history: JSON.parse(localStorage.getItem('vcalc_history')) || [],
    aliases: JSON.parse(localStorage.getItem('vcalc_aliases')) || { 'กาแฟ': 50, 'น้ำ': 10 },
    currentTimeout: null,
    expression: '',
    lastCalculated: 0,
    isResuming: false,
    resetKeywords: JSON.parse(localStorage.getItem('vcalc_reset_kw')) || ['เริ่มใหม่', 'เอาใหม่', 'ใหม่'],
    paymentKeywords: JSON.parse(localStorage.getItem('vcalc_payment_kw')) || ['รับเงินมา', 'รับมา', 'รับเงิน']
};

// Thai Logic Maps
const THAI_NUMBER_WORDS = {
    'ศูนย์': 0, 'หนึ่ง': 1, 'เอ็ด': 1, 'สอง': 2, 'ยี่': 2, 'สาม': 3, 'สี่': 4, 'ห้า': 5, 
    'หก': 6, 'เจ็ด': 7, 'แปด': 8, 'เก้า': 9, 'สิบ': 10, 'ร้อย': 100, 'พัน': 1000, 
    'หมื่น': 10000, 'แสน': 100000, 'ล้าน': 1000000
};

const THAI_OPERATORS = {
    'บวก': '+', 'เพิ่ม': '+', 'รวม': '+',
    'ลบ': '-', 'เอาออก': '-', 'ถอน': '-',
    'คูณ': '*', 'เท่าของ': '*',
    'หาร': '/', 'แบ่ง': '/'
};

const TRIGGERS = ['เท่ากับ', 'เท่าไหร่', 'เป็น', 'ได้เท่าไหร่'];

// Speech Recognition Init
let recognition = null;
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'th-TH';

    recognition.onstart = () => {
        state.isListening = true;
        indicator.classList.add('listening');
        statusText.innerText = 'กำลังฟัง...';
        startBtn.innerHTML = '<span class="icon">⏹️</span> หยุดฟัง';
    };

    recognition.onend = () => {
        state.isListening = false;
        indicator.classList.remove('listening');
        statusText.innerText = 'หยุดฟังแล้ว';
        startBtn.innerHTML = '<span class="icon">🎙️</span>เริ่มฟังเสียง';
        if (state.expression) finalizeCalculation();
    };

    recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }

        const currentText = (finalTranscript || interimTranscript).trim();
        if (currentText) {
            transcriptEl.innerText = currentText;
            handleSpeechInput(currentText);
        }
    };
}

function handleSpeechInput(text) {
    // 1. Check for Voice Reset
    const shouldReset = state.resetKeywords.some(kw => text.includes(kw));
    if (shouldReset) {
        resetApp();
        transcriptEl.innerText = "ล้างข้อมูลเรียบร้อย (คำสั่งเสียง)";
        return;
    }

    // 2. Check for Payment Mode
    const paymentKW = state.paymentKeywords.find(kw => text.includes(kw));
    if (paymentKW) {
        processPayment(text, paymentKW);
        return;
    }

    // 3. Check for immediate triggers
    const needsImmediate = TRIGGERS.some(t => text.includes(t));
    
    // 4. Process math string
    let mathStr = text;
    
    // Replace Aliases
    Object.keys(state.aliases).forEach(word => {
        mathStr = mathStr.replace(new RegExp(word, 'g'), state.aliases[word]);
    });

    // Replace Operators
    Object.keys(THAI_OPERATORS).forEach(op => {
        mathStr = mathStr.replace(new RegExp(op, 'g'), THAI_OPERATORS[op]);
    });

    // Filter only math chars (Digits, Dots, Operators)
    const filtered = mathStr.match(/[0-9+\-*/.]+/g);
    if (!filtered) return;

    const currentInput = filtered.join('');
    
    const startsWithOperator = /^[+\-*/]/.test(currentInput);
    if (startsWithOperator && state.isResuming && state.lastCalculated !== 0) {
        state.expression = state.lastCalculated + currentInput;
    } else {
        state.expression = currentInput;
        state.isResuming = false; // Stop resuming if we speak a fresh number or something else
    }

    mathPreviewEl.innerText = state.expression;

    // 3. Calculation logic
    clearTimeout(state.currentTimeout);
    
    if (needsImmediate) {
        finalizeCalculation();
    } else {
        startCountdown();
    }
}

function startCountdown() {
    let start = null;
    const duration = state.delay * 1000;
    
    const step = (timestamp) => {
        if (!start) start = timestamp;
        const progress = timestamp - start;
        const percent = Math.min((progress / duration) * 100, 100);
        delayProgress.style.width = percent + '%';
        
        if (progress < duration) {
            state.animationFrame = requestAnimationFrame(step);
        } else {
            finalizeCalculation();
        }
    };
    
    cancelAnimationFrame(state.animationFrame);
    state.animationFrame = requestAnimationFrame(step);
}

function processPayment(text, kw) {
    const afterKW = text.split(kw)[1];
    if (!afterKW) return;
    
    const amountStr = afterKW.match(/[0-9]+/g);
    if (!amountStr) return;
    
    const received = parseInt(amountStr[0]);
    const bill = state.lastCalculated;
    const change = received - bill;
    
    state.expression = `${received} - ${bill}`;
    resultEl.innerText = new Intl.NumberFormat('th-TH').format(change);
    mathPreviewEl.innerText = `${received} - ${bill}`;
    transcriptEl.innerText = `รับเงินมา ${received} บาท (ยอดรวม ${bill})`;
    
    saveToHistory(`ทอนจาก ${received}`, change);
}

function resetApp() {
    transcriptEl.innerText = 'รอฟังเสียงของคุณ...';
    resultEl.innerText = '0';
    mathPreviewEl.innerText = '0 + 0';
    state.expression = '';
    state.lastCalculated = 0;
    state.isResuming = false;
    delayProgress.style.width = '0%';
    cancelAnimationFrame(state.animationFrame);
}

function finalizeCalculation() {
    try {
        // Simple eval safely for prototype
        const result = eval(state.expression);
        if (isNaN(result) || result === Infinity) return;

        state.lastCalculated = result;
        resultEl.innerText = new Intl.NumberFormat('th-TH').format(result);
        delayProgress.style.width = '0%';
        
        saveToHistory(state.expression, result);
    } catch (e) {
        console.warn('Calculation error', e);
    }
}

function saveToHistory(exp, res) {
    const entry = {
        id: Date.now(),
        time: new Date().toLocaleTimeString('th-TH'),
        date: new Date().toLocaleDateString('th-TH'),
        expression: exp,
        result: res
    };
    
    // Check if duplicate of last
    if (state.history.length > 0 && state.history[0].expression === exp) return;

    state.history.unshift(entry);
    if (state.history.length > 50) state.history.pop();
    
    localStorage.setItem('vcalc_history', JSON.stringify(state.history));
    renderHistory();
}

function renderHistory() {
    if (!state.history.length) {
        historyList.innerHTML = '<p class="empty-msg">ยังไม่มีประวัติการคำนวณ</p>';
        return;
    }

    historyList.innerHTML = state.history.map(item => `
        <div class="history-item" onclick="resumeFromHistory(${item.result}, '${item.expression}')">
            <div class="history-time">${item.date} ${item.time}</div>
            <div class="history-exp">${item.expression}</div>
            <div class="history-res">${new Intl.NumberFormat('th-TH').format(item.result)} บาท</div>
            <div class="resume-hint">คลิกเพื่อคำนวณต่อ</div>
        </div>
    `).join('');
}

window.resumeFromHistory = (result, exp) => {
    state.lastCalculated = result;
    state.expression = result.toString();
    state.isResuming = true;
    resultEl.innerText = new Intl.NumberFormat('th-TH').format(result);
    mathPreviewEl.innerText = result.toString();
    transcriptEl.innerText = `เริ่มต่อจาก: ${new Intl.NumberFormat('th-TH').format(result)}`;
    document.getElementById('history-panel').classList.add('hidden');
    
    // Pulse effect to show it's loaded
    indicator.style.transform = 'scale(1.02)';
    setTimeout(() => indicator.style.transform = 'scale(1)', 200);
};

// Backup & Restore Logic
function exportData() {
    const includeSettings = document.getElementById('backup-settings-chk').checked;
    const includeHistory = document.getElementById('backup-history-chk').checked;
    
    if (!includeSettings && !includeHistory) {
        alert('กรุณาเลือกสิ่งที่ต้องการสำรองข้อมูล');
        return;
    }

    const exportObj = {};
    if (includeSettings) {
        exportObj.settings = {
            delay: state.delay,
            aliases: state.aliases,
            resetKeywords: state.resetKeywords,
            paymentKeywords: state.paymentKeywords
        };
    }
    if (includeHistory) {
        exportObj.history = state.history;
    }

    const dataStr = JSON.stringify(exportObj, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `vcalc_backup_${new Date().toISOString().slice(0,10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
}

function importData(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const imported = JSON.parse(event.target.result);
            const includeSettings = document.getElementById('backup-settings-chk').checked;
            const includeHistory = document.getElementById('backup-history-chk').checked;

            if (includeSettings && imported.settings) {
                const s = imported.settings;
                state.delay = s.delay || state.delay;
                state.aliases = s.aliases || state.aliases;
                state.resetKeywords = s.resetKeywords || state.resetKeywords;
                state.paymentKeywords = s.paymentKeywords || state.paymentKeywords;
                
                localStorage.setItem('vcalc_delay', state.delay);
                localStorage.setItem('vcalc_aliases', JSON.stringify(state.aliases));
                localStorage.setItem('vcalc_reset_kw', JSON.stringify(state.resetKeywords));
                localStorage.setItem('vcalc_payment_kw', JSON.stringify(state.paymentKeywords));
                
                // Update UI fields
                delayInput.value = state.delay;
                document.getElementById('reset-keywords-input').value = state.resetKeywords.join(', ');
                document.getElementById('payment-keywords-input').value = state.paymentKeywords.join(', ');
                renderAliases();
            }

            if (includeHistory && imported.history) {
                // Merge history and remove duplicates by id/time
                const combined = [...imported.history, ...state.history];
                const unique = Array.from(new Map(combined.map(item => [item.id || item.time, item])).values());
                state.history = unique.sort((a, b) => (b.id || 0) - (a.id || 0)).slice(0, 50);
                
                localStorage.setItem('vcalc_history', JSON.stringify(state.history));
                renderHistory();
            }

            alert('นำเข้าข้อมูลสำเร็จ!');
            e.target.value = ''; // Reset input
        } catch (err) {
            console.error('Import error:', err);
            alert('ไฟล์ไม่ถูกต้อง หรือเกิดข้อผิดพลาดในการนำเข้า');
        }
    };
    reader.readAsText(file);
}

// Settings & Events
function updateDelay() {
    state.delay = parseFloat(delayInput.value) || 1.5;
    localStorage.setItem('vcalc_delay', state.delay);
}

function renderAliases() {
    const listEl = document.getElementById('alias-list');
    listEl.innerHTML = Object.keys(state.aliases).map(key => `
        <div class="alias-row">
            <span>${key} = ${state.aliases[key]}</span>
            <button onclick="deleteAlias('${key}')" class="icon-btn">🗑️</button>
        </div>
    `).join('');
}

window.deleteAlias = (key) => {
    delete state.aliases[key];
    localStorage.setItem('vcalc_aliases', JSON.stringify(state.aliases));
    renderAliases();
};

document.getElementById('add-alias-btn').addEventListener('click', () => {
    const word = document.getElementById('alias-word').value.trim();
    const val = document.getElementById('alias-value').value.trim();
    if (word && val) {
        state.aliases[word] = val;
        localStorage.setItem('vcalc_aliases', JSON.stringify(state.aliases));
        renderAliases();
        document.getElementById('alias-word').value = '';
        document.getElementById('alias-value').value = '';
    }
});

toggleHistory.addEventListener('click', () => {
    document.getElementById('history-panel').classList.toggle('hidden');
    renderHistory();
});

toggleSettings.addEventListener('click', () => {
    document.getElementById('settings-panel').classList.toggle('hidden');
    renderAliases();
});

startBtn.addEventListener('click', () => {
    if (state.isListening) {
        recognition.stop();
    } else {
        recognition.start();
    }
});

resetBtn.addEventListener('click', resetApp);

document.getElementById('export-btn').addEventListener('click', exportData);
document.getElementById('import-trigger-btn').addEventListener('click', () => {
    document.getElementById('import-file-input').click();
});
document.getElementById('import-file-input').addEventListener('change', importData);

document.getElementById('reset-keywords-input').addEventListener('change', (e) => {
    state.resetKeywords = e.target.value.split(',').map(s => s.trim()).filter(s => s);
    localStorage.setItem('vcalc_reset_kw', JSON.stringify(state.resetKeywords));
});

document.getElementById('payment-keywords-input').addEventListener('change', (e) => {
    state.paymentKeywords = e.target.value.split(',').map(s => s.trim()).filter(s => s);
    localStorage.setItem('vcalc_payment_kw', JSON.stringify(state.paymentKeywords));
});

document.getElementById('clear-history-btn').addEventListener('click', () => {
    state.history = [];
    localStorage.setItem('vcalc_history', '[]');
    renderHistory();
});

delayInput.addEventListener('change', updateDelay);

// Initial Render
renderHistory();
renderAliases();

document.getElementById('reset-keywords-input').value = state.resetKeywords.join(', ');
document.getElementById('payment-keywords-input').value = state.paymentKeywords.join(', ');
