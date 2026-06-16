# CipherVault — AES-256 Encryption System

A browser-based, client-side encryption app built with React. CipherVault lets users encrypt and decrypt text files, raw text, and images using AES-256-GCM — entirely in the browser, with no data ever sent to a server.

---

## Features

- **Text File Encryption** — Upload a `.txt` file and encrypt/decrypt it; output is downloaded as an `.aes256.txt` file.
- **Plain Text Encryption** — Type or paste text directly into the browser and get an encrypted string you can copy and store anywhere.
- **Image Encryption** — Encrypt any image (PNG, JPEG, GIF, WebP, etc.) into a distorted-looking `.aes256.png` file, and decrypt it back to the original.
- **User Authentication** — Local account system with registration, login, and session persistence via `localStorage`.
- **Change Password** — Authenticated users can update their account password at any time.

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI Framework | React (with hooks) |
| Styling | Tailwind CSS |
| Icons | Lucide React |
| Cryptography | Web Crypto API (native browser) |
| Storage | `localStorage` (accounts & sessions) |
| File I/O | `FileReader` API, `Blob`, `URL.createObjectURL` |

---

## How It Works

### Encryption Algorithm

All encryption uses **AES-256-GCM** with keys derived via **PBKDF2-SHA256**:

- **Key derivation**: PBKDF2 with 250,000 iterations, a random 16-byte salt, and SHA-256 hashing.
- **Encryption**: AES-256-GCM with a random 12-byte IV per operation.
- **Output format**: `base64(salt):base64(iv):base64(ciphertext)`

No encryption key or password is ever stored — only the encrypted output.

### Image Encryption

Images go through two layers:

1. The raw file bytes are AES-256-GCM encrypted, producing a JSON payload.
2. That JSON payload is packed byte-by-byte into the RGB pixels of a **hand-crafted PNG** (bypassing the browser's canvas API entirely to avoid color-correction or compression artifacts).

The result looks like a distorted/noisy image. Decryption reverses this: the PNG pixel data is read, the JSON payload is extracted, and the original file is decrypted and restored with its original filename and MIME type.

### PNG Encoding (Technical Detail)

The PNG is built from scratch using:
- A custom **zlib-store** deflate implementation (uncompressed blocks)
- Hand-written **IHDR**, **IDAT**, and **IEND** chunk assembly
- CRC-32 and Adler-32 checksums computed manually

This avoids any browser-side color transformation that would corrupt ciphertext data encoded in pixel values.

---

## Project Structure

```
EncryptionSystem.jsx
│
├── CryptoEngine          # AES-256-GCM encrypt/decrypt, PBKDF2 key derivation
├── AccountManager        # User registration, login, session, password change
├── FileProcessor         # File I/O, PNG builder/parser, download helpers
│
├── AuthScreen            # Login / Sign-up UI
├── ChangePasswordModal   # Modal for updating account password
│
├── TextFileCryptoPanel   # .txt file encrypt/decrypt tab
├── TextAreaCryptoPanel   # In-browser text encrypt/decrypt tab
├── ImageCryptoPanel      # Image encrypt/decrypt tab
│
└── EncryptionSystem      # Root component — auth gate + tab routing
```

---

## Getting Started

### Prerequisites

- Node.js 16+
- A React project (e.g. created with Vite or Create React App)
- Tailwind CSS configured
- `lucide-react` installed

### Installation

```bash
npm install lucide-react
```

Copy `EncryptionSystem.jsx` into your project's `src/` directory, then import and render it:

```jsx
import EncryptionSystem from './EncryptionSystem';

function App() {
  return <EncryptionSystem />;
}
```

### Run

```bash
npm run dev
```

Open your browser at `http://localhost:5173` (or whichever port your dev server uses).

---

## Usage

### 1. Create an Account
On first load, click **Sign Up**, enter your name, email, and a password. Your account is stored locally in the browser.

### 2. Log In
Use your email and password to log in. Your session is persisted across page refreshes.

### 3. Choose a Mode
Use the three tabs at the top:

| Tab | What it does |
|---|---|
| **Text Files** | Encrypt/decrypt `.txt` files — downloaded as `.aes256.txt` |
| **Plain Text** | Encrypt/decrypt text directly in the browser |
| **Images** | Encrypt/decrypt image files — encrypted output is a `.aes256.png` |

### 4. Encrypt
1. Select the file or paste your text.
2. Enter an **AES Key Password** — this is the passphrase used to derive your encryption key. **Store it safely; it cannot be recovered.**
3. Click **Encrypt & Download**.

### 5. Decrypt
1. Switch the toggle to **Decrypt**.
2. Upload the `.aes256.txt` or `.aes256.png` file.
3. Enter the **same password** used during encryption.
4. Click **Decrypt & Download** — the original file is restored.

---

## Security Notes

- All cryptographic operations run **entirely in the browser** using the native Web Crypto API. No data leaves your device.
- The AES key password is **never stored** anywhere. If you forget it, the encrypted data cannot be recovered.
- User account passwords are stored in **plaintext in `localStorage`** — this system is intended as an educational/local-use tool and is **not suitable for production authentication**.
- Each encrypt operation uses a **fresh random salt and IV**, so encrypting the same plaintext twice produces different ciphertext.

---

## Limitations

- File size: Very large images may hit browser memory limits during PNG encoding.
- The account system uses `localStorage` — data is browser-local and not shared across devices.
- Encrypted `.aes256.png` files can only be decrypted by this app (the format is custom).

---

## Credits

Built at **MTI University** as part of a Dimensional Data Encryption Systems project.
