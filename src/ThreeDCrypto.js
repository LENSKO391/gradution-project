
// SECTION 1: EYAD - Binary File Processing & 3D Validation (CORE LOGIC)
// =========================================================================
export const ThreeDHelper = {
    // Validates 3D model extensions supported by the system
    is3D(file) {
        return file && /\.(glb|gltf|obj|stl|fbx)$/i.test(file.name);
    },

    // Reads file as ArrayBuffer for binary manipulation
    async readAsArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = () => reject(new Error('Failed to read 3D binary data.'));
            reader.readAsArrayBuffer(file);
        });
    },

    // Handles downloading of binary blobs
    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
};

// =========================================================================
// SECTION 2: GEORGE - AES-256 GCM Multi-Dimensional Encryption Engine (CORE LOGIC)
// =========================================================================
export const ThreeDCryptoEngine = {
    ITERATIONS: 250000,

    async deriveKey(password, salt) {
        const encoder = new TextEncoder();     //for converting password to bytes
        const baseKey = await crypto.subtle.importKey(
            'raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']
        );
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt, iterations: this.ITERATIONS, hash: 'SHA-256' },
            baseKey,                                     // Password after conversion
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    },

    async encrypt3D(plainBytes, password) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await this.deriveKey(password, salt);
        
        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv }, 
            key, 
            plainBytes
        );

        return {
            ciphertext: ThreeDCryptoEngine.toB64(ciphertext),
            salt: ThreeDCryptoEngine.toB64(salt),
            iv: ThreeDCryptoEngine.toB64(iv),
            algorithm: 'AES-256-GCM',
            dimension: '3d'
        };
    },

    // Helpers for Base64 conversion (George/Hana collaboration)
    toB64(buf) {
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    }
};

// =========================================================================
// SECTION 3: HANA - Binary Reconstruction & Steganographic Decryption (CORE LOGIC)
// =========================================================================
export const ThreeDDecryptionLogic = {
    fromB64(str) {
        return Uint8Array.from(atob(str), c => c.charCodeAt(0));
    },

    async decrypt3D(payload, password) {
        const { ciphertext, salt, iv } = payload;
        const key = await ThreeDCryptoEngine.deriveKey(password, this.fromB64(salt));
        
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: this.fromB64(iv) },
            key,
            this.fromB64(ciphertext)
        );

        return new Uint8Array(decrypted);
    },

    // Logic for parsing the distorted PNG container back into JSON metadata
    async extractMetadataFromPng(pngFile) {
        // This simulates the extraction of the 3D metadata from the distorted image
        // In the real app, this uses FileProcessor._parsePNG
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
                // Metadata extraction logic goes here
                resolve(true); 
            };
            reader.readAsArrayBuffer(pngFile);
        });
    }
};

// =========================================================================
// SECTION 4: DAVID - 3D Visualization & Geometry Preview Management (CORE LOGIC)
// =========================================================================
const ThreeDPreview = ({ file }) => {
    return (
        <div className="mt-4 rounded-xl overflow-hidden border border-slate-700 bg-slate-950 p-6 flex flex-col items-center justify-center gap-4 animate-in fade-in zoom-in duration-500">
            <div className="w-20 h-20 rounded-2xl bg-cyan-500/10 flex items-center justify-center text-cyan-500 shadow-lg shadow-cyan-500/5">
                <Box size={40} className="animate-pulse" />
            </div>
            <div className="text-center">
                <p className="text-sm font-bold text-slate-200">3D Geometry Detected</p>
                <p className="text-xs text-slate-500 font-mono mt-1">{file?.name || 'model.stl'}</p>
                <div className="flex gap-2 mt-3 justify-center">
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-cyan-400 border border-cyan-900/30">Binary STL</span>
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400 border border-slate-700">Vertex Data Safe</span>
                </div>
            </div>
        </div>
    );
};

// =========================================================================
// SECTION 5: MOAZ - Feedback Systems & Status Notifications
// =========================================================================
const StatusNotice = ({ type, message }) => {
    if (!message) return null;
    return (
        <div className={`p-4 rounded-xl text-sm flex items-start gap-3 border ${
            type === 'error' 
                ? 'bg-red-950/30 border-red-800/50 text-red-200' 
                : 'bg-emerald-950/30 border-emerald-800/50 text-emerald-200'
        }`}>
            {type === 'success' ? <CheckCircle size={18} className="shrink-0" /> : <Info size={18} className="shrink-0" />}
            <p className="font-medium">{message}</p>
        </div>
    );
};

// =========================================================================
// SECTION 6: MOSSAB - UI Layout & Operation Mode Toggles
// =========================================================================
const ModeSwitcher = ({ mode, setMode }) => (
    <div className="flex gap-2 p-1.5 bg-slate-900/80 rounded-xl border border-slate-700/50">
        {['encrypt', 'decrypt'].map(m => (
            <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 py-2.5 rounded-lg font-bold text-xs uppercase tracking-wider transition-all ${
                    mode === m ? 'bg-cyan-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'
                }`}
            >
                {m === 'encrypt' ? 'Secure Encryption' : 'Secure Decryption'}
            </button>
        ))}
    </div>
);

// =========================================================================
// SECTION 7: GAMAL - Component Layout & UI Integration
// =========================================================================
export const ThreeDCryptoPanel = ({ user, addHistory }) => {
    const [mode, setMode] = useState('encrypt');
    const [file, setFile] = useState(null);
    const [password, setPassword] = useState('');
    const [status, setStatus] = useState({ type: '', msg: '' });
    const [loading, setLoading] = useState(false);

    const handleFileChange = (e) => {
        const selected = e.target.files[0];
        setStatus({ type: '', msg: '' });
        if (!selected) return;

        if (mode === 'encrypt' && !ThreeDHelper.is3D(selected)) {
            setStatus({ type: 'error', msg: 'Invalid Format: Please select a 3D file (.stl, .obj)' });
            setFile(null);
            return;
        }
        setFile(selected);
    };

    // =========================================================================
    // SECTION 8: ESLAM - Operation Execution
    // =========================================================================
    const process3D = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            const bytes = await ThreeDHelper.readAsArrayBuffer(file);
            const res = await ThreeDCryptoEngine.encrypt3D(bytes, password);
            ThreeDHelper.downloadBlob(new Blob([JSON.stringify(res)]), `${file.name}.aes256`);
            setStatus({ type: 'success', msg: '3D Encrypted Successfully' });
        } catch {
            setStatus({ type: 'error', msg: 'Processing Failed' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <ModeSwitcher mode={mode} setMode={setMode} />
            
            <StatusNotice type={status.type} message={status.msg} />

            <div className="space-y-4">
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">3D Source File</label>
                    <div className="relative group">
                        <input
                            type="file"
                            onChange={handleFileChange}
                            className="w-full bg-slate-900 border border-slate-700 text-slate-300 rounded-xl p-4 text-sm file:mr-4 file:py-1 file:px-3 file:rounded-md file:border-0 file:bg-cyan-600 file:text-white file:text-xs file:font-bold hover:border-slate-600 transition-all"
                        />
                    </div>
                </div>

                {file && mode === 'encrypt' && <ThreeDPreview file={file} />}

                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Encryption Key</label>
                    <div className="relative">
                        <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" size={18} />
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••••••••••"
                            className="w-full pl-12 pr-4 py-4 bg-slate-900 border border-slate-700 text-cyan-400 rounded-xl focus:ring-2 focus:ring-cyan-500 focus:outline-none text-sm font-mono"
                        />
                    </div>
                </div>

                <button
                    onClick={process3D}
                    disabled={loading || !file || !password}
                    className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 text-white py-4 rounded-xl font-bold shadow-xl hover:shadow-cyan-900/20 hover:from-cyan-500 hover:to-blue-500 transition-all disabled:opacity-50 disabled:grayscale"
                >
                    {loading ? 'Processing Geometry...' : mode === 'encrypt' ? 'ENCRYPT 3D MODEL' : 'DECRYPT 3D MODEL'}
                </button>
            </div>

            <div className="pt-4 border-t border-slate-800 flex items-center gap-2 text-slate-600">
                <Shield size={14} />
                <span className="text-[10px] font-bold uppercase tracking-tighter">Advanced 3D Geometry Protection Active</span>
            </div>
        </div>
    );
};
