document.getElementById('contactForm').addEventListener('submit', function(event) {
    event.preventDefault();

    // Get form values
    const fullName = document.getElementById('fullName').value.trim();
    const email = document.getElementById('email').value.trim();
    const phoneNumber = document.getElementById('phoneNumber').value.trim();
    const message = document.getElementById('message').value.trim();
    const warningMessage = document.getElementById('warningMessage');

    // Check if any required field is empty
    if (!fullName || !email || !phoneNumber || !message) {
        warningMessage.textContent = 'All fields are required. Please complete the form.';
        warningMessage.style.display = 'block';
        return;
    }

    // Reset warning message
    warningMessage.style.display = 'none';

    // If validation passes, allow the form to submit to Formspree
    this.submit();
});
