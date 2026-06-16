import React, { useState } from 'react';
import { Database } from 'lucide-react';
import * as XLSX from 'xlsx';

// =========================================================================
// SECTION 1: Gamal - 
// =========================================================================
export const DatasetCryptoPanel = ({ user, accountManager, FileProcessor, CryptoEngine, Notice, ModeToggle, KeyInput, SubmitBtn }) => {
    const [mode, setMode] = useState('encrypt');
    const [file, setFile] = useState(null);
    const [key, setKey] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [processing, setProcessing] = useState(false);
    const [preview, setPreview] = useState(null);

    const reset = () => { setError(''); setSuccess(''); };

    // =========================================================================
    // SECTION 2: David 
    // =========================================================================
    const parsePreview = async (f) => {
        try {
            if (DatasetHelper.isXlsx(f)) {
                const buf = await FileProcessor.readArrayBuffer(f);
                const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
                const ws = wb.Sheets[wb.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
                if (rows.length === 0) return null;
                const headers = rows[0].map(h => String(h ?? ''));
                const dataRows = rows.slice(1, 6).map(r => headers.map((_, ci) => String(r[ci] ?? '')));
                return { headers, rows: dataRows, totalRows: rows.length - 1 };
            } else {
                const text = await f.text();
                const lines = text.split(/\r?\n/).filter(l => l.trim());
                if (lines.length === 0) return null;
                const parseRow = (row) => {
                    const cells = [];
                    let current = '';
                    let inQuotes = false;
                    for (let i = 0; i < row.length; i++) {
                        const ch = row[i];
                        if (ch === '"') {
                            if (inQuotes && row[i + 1] === '"') { current += '"'; i++; }
                            else inQuotes = !inQuotes;
                        } else if (ch === ',' && !inQuotes) {
                            cells.push(current.trim());
                            current = '';
                        } else {
                            current += ch;
                        }
                    }
                    cells.push(current.trim());
                    return cells;
                };
                const headers = parseRow(lines[0]);
                const rows = lines.slice(1, 6).map(parseRow);
                return { headers, rows, totalRows: lines.length - 1 };
            }
        } catch { return null; }
    };

    // =========================================================================
    // SECTION 3: Moaz 
    // =========================================================================
    const handleFile = async (e) => {
        const f = e.target.files?.[0] || null;
        setFile(null); setPreview(null); reset();
        if (!f) return;
        if (mode === 'encrypt') {
            if (!DatasetHelper.isDataset(f)) return setError('Only .csv and .xlsx files are allowed.');
            setFile(f);
            setPreview(await parsePreview(f));
        } else {
            if (!f.name.toLowerCase().endsWith('.encrypted.csv')) return setError('Please select an .encrypted.csv file.');
            setFile(f);
        }
    };

    // =========================================================================
    // SECTION 4: George
    // =========================================================================
    const handleSubmit = async (e) => {
        e.preventDefault();
        reset();
        if (!file) return setError('Please select a dataset file.');
        if (!key) return setError('Please enter a key password.');
        setProcessing(true);
        try {
            if (mode === 'encrypt') {
                const buf = await FileProcessor.readArrayBuffer(file);
                const plainBytes = new Uint8Array(buf);
                const payload = await CryptoEngine.encrypt({ plainBytes, password: key });
                payload.originalName = file.name;
                payload.mimeType = file.type || (DatasetHelper.isXlsx(file) ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv');
                // Serialize payload to base64 so no metadata is visible in the CSV, just encrypted chunks
                const serialized = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
                const CHUNK = 30000;
                const csvRows = [];
                for (let i = 0; i < serialized.length; i += CHUNK) {
                    csvRows.push(serialized.slice(i, i + CHUNK));
                }
                const csvContent = csvRows.join('\n');
                await FileProcessor.download({ text: csvContent, name: `${file.name}.encrypted.csv`, mimeType: 'text/csv;charset=utf-8' });
                accountManager.addHistory(user.email, { file: file.name, action: 'Encrypt Dataset' });
                setSuccess(`Encrypted "${file.name}" and downloaded as .csv.`);
            } else {
                // =========================================================================
                // SECTION 5: Hana 
                // =========================================================================
                const text = await file.text();
                const lines = text.split(/\r?\n/).filter(l => l.trim());
                const serialized = lines.join('');
                let payloadMap;
                try {
                    payloadMap = JSON.parse(decodeURIComponent(escape(atob(serialized))));
                } catch {
                    throw new Error('Could not parse encrypted file. Make sure it was encrypted by this app.');
                }

                if (!payloadMap.ciphertext || !payloadMap.salt || !payloadMap.iv) throw new Error('Could not parse encrypted file. Make sure it was encrypted by this app.');
                if (payloadMap.algorithm !== 'AES-256-GCM') throw new Error('Unsupported algorithm.');
                const payload = { ...payloadMap, iterations: Number(payloadMap.iterations) || 250000 };
                const plainBytes = await CryptoEngine.decrypt({ payload, password: key });
                const mimeType = payloadMap.mimeType || 'text/csv';
                const originalName = DatasetHelper.decryptedDatasetName(file.name, payloadMap.originalName);
                await FileProcessor.downloadBytes({ bytes: plainBytes, name: originalName, mimeType });
                accountManager.addHistory(user.email, { file: file.name, action: 'Decrypt Dataset' });
                setSuccess(`Decrypted and downloaded as "${originalName}".`);
            }
        } catch (err) {
            setError(err.message || 'Operation failed. Check your key and try again.');
        } finally {
            setProcessing(false);
            setKey('');
        }
    };

    // =========================================================================
    // SECTION 6: Mosaab
    // =========================================================================
    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            {error && <Notice type="error">{error}</Notice>}
            {success && <Notice type="success">{success}</Notice>}
            <ModeToggle value={mode} onChange={m => { setMode(m); setFile(null); setPreview(null); setKey(''); reset(); }} />
            <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                    {mode === 'encrypt' ? 'Dataset File (.csv, .xlsx)' : 'Encrypted Dataset File (.encrypted.csv)'}
                </label>
                <input
                    type="file"
                    accept={mode === 'encrypt' ? '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : '.csv,.encrypted.csv'}
                    onChange={handleFile}
                    className="w-full bg-slate-900 border border-slate-600/80 text-slate-300 rounded-lg p-3 text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-cyan-700 file:text-white file:text-xs"
                    required
                />
                {file && <p className="text-slate-500 text-xs mt-1.5">Selected: {file.name}</p>}
            </div>

            {/* =========================================================================
            SECTION 7: Eslam 
            ========================================================================= */}
            {preview && (
                <div className="rounded-lg border border-slate-600/60 overflow-hidden">
                    <div className="bg-slate-900/80 px-3 py-2 flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-400">Dataset Preview</span>
                        <span className="text-xs text-slate-500">{preview.totalRows} row{preview.totalRows !== 1 ? 's' : ''} total{preview.rows.length < preview.totalRows ? `, showing first ${preview.rows.length}` : ''}</span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="bg-slate-800">
                                    {preview.headers.map((h, i) => (
                                        <th key={i} className="px-3 py-2 text-left text-cyan-400 font-semibold border-b border-slate-700 whitespace-nowrap">{h || `Col ${i + 1}`}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {preview.rows.map((row, ri) => (
                                    <tr key={ri} className={ri % 2 === 0 ? 'bg-slate-900/40' : 'bg-slate-900/70'}>
                                        {preview.headers.map((_, ci) => (
                                            <td key={ci} className="px-3 py-1.5 text-slate-300 border-b border-slate-800/60 whitespace-nowrap max-w-[200px] truncate">{row[ci] ?? ''}</td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Key Password</label>
                <KeyInput value={key} onChange={setKey} />
            </div>
            <SubmitBtn processing={processing} mode={mode} label={mode === 'encrypt' ? 'Encrypt Dataset & Download' : 'Decrypt Dataset & Download'} />
        </form>
    );
};

// =========================================================================
// SECTION 8: Eyad
// =========================================================================
export const DatasetHelper = {
    isCsv(file) { return file && (file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv')); },
    isXlsx(file) { return file && (file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || file.name.toLowerCase().endsWith('.xlsx')); },
    isDataset(file) { return DatasetHelper.isCsv(file) || DatasetHelper.isXlsx(file); },

    decryptedDatasetName(name, originalName = '') {
        // If the original name was recorded in the payload (e.g. data.xlsx)
        if (originalName) {
            const extIdx = originalName.lastIndexOf('.');
            if (extIdx !== -1) {
                const base = originalName.substring(0, extIdx);
                const ext = originalName.substring(extIdx);
                return `${base}.decrypted${ext}`;
            }
            return `${originalName}.decrypted`;
        }

        // Fallback if no original name was in the payload
        if (name.endsWith('.encrypted.csv')) {
            const original = name.replace('.encrypted.csv', '');
            const ext = original.substring(original.lastIndexOf('.'));
            const base = original.substring(0, original.lastIndexOf('.'));
            return `${base}.decrypted${ext}`;
        }
        return `${name}.decrypted`;
    }
};
