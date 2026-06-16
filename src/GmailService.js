/**
 * Encodes string to base64url format for the Gmail API
 */
const toBase64URL = (str) => {
    return btoa(unescape(encodeURIComponent(str)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  };
  
  /**
   * Convert a Uint8Array or ArrayBuffer to a Base64 string chunked for MIME
   */
  const arrayBufferToBase64 = (buffer) => {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };
  
  export const sendEmailWithAttachment = async ({
    accessToken,
    recipientEmail,
    subject,
    messageBody,
    attachmentFile, // File object or Blob
    attachmentName
  }) => {
    if (!accessToken) throw new Error("Missing Google Access Token. Please sign out and sign in again.");
  
    // Convert File/Blob to ArrayBuffer for encoding
    const arrayBuffer = await attachmentFile.arrayBuffer();
    const base64Data = arrayBufferToBase64(arrayBuffer);
    
    const boundary = "boundary_123456789";
    const mimeType = attachmentFile.type || "application/octet-stream";
    
    // Construct Raw MIME format email
    let rawMessage = 
      `To: ${recipientEmail}\r\n` +
      `Subject: ${subject}\r\n` +
      `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: text/plain; charset="UTF-8"\r\n\r\n` +
      `${messageBody}\r\n\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${mimeType}; name="${attachmentName}"\r\n` +
      `Content-Disposition: attachment; filename="${attachmentName}"\r\n` +
      `Content-Transfer-Encoding: base64\r\n\r\n` +
      `${base64Data}\r\n\r\n` +
      `--${boundary}--`;
  
    const encodedMessage = toBase64URL(rawMessage);
  
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        raw: encodedMessage
      })
    });
  
    if (!response.ok) {
      let errorMessage = "Unknown error occurred while sending email.";
      try {
        const errorData = await response.json();
        errorMessage = `Gmail API Error: ${errorData.error?.message || errorMessage}`;
      } catch (e) {}
      throw new Error(errorMessage);
    }
  
    return response.json();
  };
