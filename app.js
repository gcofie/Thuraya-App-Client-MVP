/* FULL app.js - DATE FIX INCLUDED */

function isTouchDevice() {
    return (
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0 ||
        window.matchMedia("(pointer: coarse)").matches
    );
}

function enhanceDateInputs() {
    const dateInputs = document.querySelectorAll('input[type="date"]');

    dateInputs.forEach(input => {

        input.style.opacity = '';
        input.style.position = '';
        input.style.zIndex = '';
        input.style.pointerEvents = '';
        input.classList.remove('enhanced-date');

        if (!isTouchDevice()) return;

        input.classList.add('enhanced-date');

        input.style.opacity = 0;
        input.style.position = 'absolute';
        input.style.zIndex = 2;
        input.style.width = '100%';
        input.style.height = '100%';
        input.style.top = 0;
        input.style.left = 0;

        let display = input.parentElement.querySelector('.date-display');

        if (!display) {
            display = document.createElement('div');
            display.className = 'date-display';
            display.style.position = 'relative';
            display.style.zIndex = 1;
            display.style.padding = '12px';
            display.style.border = '1px solid #ddd';
            display.style.borderRadius = '10px';
            display.style.background = '#fff';
            display.style.cursor = 'pointer';

            input.parentElement.appendChild(display);
        }

        const updateDisplay = () => {
            if (input.value) {
                const date = new Date(input.value);
                display.innerText = date.toDateString();
            } else {
                display.innerText = 'Select date';
            }
        };

        updateDisplay();
        input.addEventListener('change', updateDisplay);

        display.onclick = () => {
            if (input.showPicker) input.showPicker();
            input.focus();
        };
    });
}

document.addEventListener("DOMContentLoaded", enhanceDateInputs);
document.addEventListener("click", () => {
    setTimeout(enhanceDateInputs, 100);
});
