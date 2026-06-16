import React, { useEffect, useState } from 'react';
import { Clock, Trash2 } from 'lucide-react';

export const HistoryPanel = ({ user, HistoryStore }) => {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [toDeleteRecord, setToDeleteRecord] = useState(null);
    const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);

    useEffect(() => {
        setLoading(true);
        HistoryStore.getRecords()
            .then(records => setHistory(records))
            .finally(() => setLoading(false));
    }, [HistoryStore]);

    const handleDelete = (record) => {
        setToDeleteRecord(record);
        setShowDeleteConfirm(true);
    };

    const confirmDelete = async () => {
        if (!toDeleteRecord) return;
        try {
            await HistoryStore.deleteRecord(toDeleteRecord.id, toDeleteRecord.storagePath);
            setHistory(h => h.filter(r => r.id !== toDeleteRecord.id));
        } catch (e) {
            alert("Failed to delete record: " + e.message);
        } finally {
            setShowDeleteConfirm(false);
            setToDeleteRecord(null);
        }
    };

    const confirmDeleteAll = async () => {
        try {
            await HistoryStore.deleteAllRecords();
            setHistory([]);
        } catch (e) {
            alert("Failed to delete all records: " + e.message);
        } finally {
            setShowDeleteAllConfirm(false);
        }
    };

    if (loading) {
        return (
            <div className="text-center py-8 text-slate-400">
                <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm">Loading history…</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {history.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                    <Clock size={48} className="mx-auto mb-3 opacity-20" />
                    <p>No activity history found for this account.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="flex justify-between items-center">
                        <h3 className="text-lg font-semibold text-slate-200">Activity History</h3>
                        <button
                            onClick={() => setShowDeleteAllConfirm(true)}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-red-700/20 hover:bg-red-700/80 text-red-400 hover:text-white rounded-md text-sm font-medium transition-colors"
                        >
                            <Trash2 size={16} />
                            Delete All Logs
                        </button>
                    </div>

                    <div className="rounded-lg border border-slate-600/60 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-800">
                                        <th className="px-4 py-3 text-left text-cyan-400 font-semibold border-b border-slate-700">Date & Time</th>
                                        <th className="px-4 py-3 text-left text-cyan-400 font-semibold border-b border-slate-700">Action</th>
                                        <th className="px-4 py-3 text-left text-cyan-400 font-semibold border-b border-slate-700">File</th>
                                        <th className="px-4 py-3 text-right text-cyan-400 font-semibold border-b border-slate-700">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {history.map((record, i) => (
                                        <tr key={record.id} className={i % 2 === 0 ? 'bg-slate-900/40' : 'bg-slate-900/70'}>
                                            <td className="px-4 py-3 text-slate-300 border-b border-slate-800/60 whitespace-nowrap">
                                                {new Date(record.date).toLocaleString()}
                                            </td>
                                            <td className="px-4 py-3 text-slate-300 border-b border-slate-800/60">
                                                <span className="inline-flex items-center px-2 py-1 rounded bg-slate-800 text-xs font-medium">
                                                    {record.action}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-slate-300 border-b border-slate-800/60 truncate max-w-[200px]" title={record.file}>
                                                {record.file}
                                            </td>
                                            <td className="px-4 py-3 border-b border-slate-800/60 text-right">
                                                <button
                                                    onClick={() => handleDelete(record)}
                                                    title="Delete Log"
                                                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-red-700/20 hover:bg-red-700/80 text-red-500 hover:text-white rounded-md text-xs font-semibold transition-colors"
                                                >
                                                    <Trash2 size={13} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete single confirmation */}
            {showDeleteConfirm && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 max-w-md w-full mx-4">
                        <h3 className="text-lg font-semibold text-slate-200 mb-4">Confirm Deletion</h3>
                        <p className="text-slate-300 mb-6">Are you sure you want to delete this history log? This cannot be undone.</p>
                        <div className="flex justify-end gap-3">
                            <button onClick={() => { setShowDeleteConfirm(false); setToDeleteRecord(null); }}
                                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-md font-medium transition-colors">
                                Cancel
                            </button>
                            <button onClick={confirmDelete}
                                className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded-md font-medium transition-colors">
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete all confirmation */}
            {showDeleteAllConfirm && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 max-w-md w-full mx-4">
                        <h3 className="text-lg font-semibold text-slate-200 mb-4">Confirm Delete All</h3>
                        <p className="text-slate-300 mb-2">Are you sure you want to delete all {history.length} history logs?</p>
                        <p className="text-red-400 text-sm mb-6">This cannot be undone.</p>
                        <div className="flex justify-end gap-3">
                            <button onClick={() => setShowDeleteAllConfirm(false)}
                                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-md font-medium transition-colors">
                                Cancel
                            </button>
                            <button onClick={confirmDeleteAll}
                                className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded-md font-medium transition-colors">
                                Delete All
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};