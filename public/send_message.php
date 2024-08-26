<?php
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true);

    $fullName = $data['fullName'];
    $email = $data['email'];
    $phoneNumber = $data['phoneNumber'];
    $message = $data['message'];

    $to = 'm.aristeguietasanchez@gmail.com';  // Replace with your actual email address
    $subject = 'New Contact Form Submission';
    $body = "Name: $fullName\nEmail: $email\nPhone: $phoneNumber\nMessage: $message";
    $headers = "From: $email";

    if (mail($to, $subject, $body, $headers)) {
        echo json_encode(['success' => true]);
    } else {
        // Debugging information
        error_log("Mail sending failed. Check the server's mail configuration.");
        echo json_encode(['success' => false, 'error' => 'Mail function failed']);
    }
} else {
    echo json_encode(['success' => false, 'error' => 'Invalid request method']);
}
?>
