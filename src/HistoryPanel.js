import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Clock, Trash2, Search, Filter, Calendar, ChevronDown, Download } from 'lucide-react';

const CustomSelect = ({ value, options, onChange, icon: Icon, label, className = "" }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    return (
        <div className={`relative ${className}`} ref={dropdownRef}>
            {Icon && <Icon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />}
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full h-10 bg-slate-900/50 hover:bg-slate-900/80 border border-slate-700 text-slate-200 rounded-md ${Icon ? 'pl-9' : 'pl-3'} pr-8 text-sm focus:outline-none focus:border-cyan-500 transition-colors text-left flex items-center justify-between`}
            >
                <div className="flex items-center truncate pr-2">
                    {label && <span className="text-slate-400 mr-1.5 font-medium">{label}:</span>}
                    <span className="truncate">{value}</span>
                </div>
                <ChevronDown size={14} className="text-slate-400 absolute right-3 pointer-events-none" />
            </button>
            
            {isOpen && (
                <div className="absolute z-20 w-full mt-1 bg-slate-800 border border-slate-700 rounded-md shadow-lg max-h-60 overflow-auto scrollbar-hide">
                    <ul className="py-1">
                        {options.map((option, idx) => (
                            <li 
                                key={idx}
                                onClick={() => {
                                    onChange(option);
                                    setIsOpen(false);
                                }}
                                className={`px-4 py-2 text-sm cursor-pointer transition-colors ${value === option ? 'bg-cyan-500/20 text-cyan-400' : 'text-slate-300 hover:bg-slate-700/50 hover:text-white'}`}
                            >
                                {option}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

export const HistoryPanel = ({ user, HistoryStore, FileProcessor, fromB64 }) => {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [toDeleteRecord, setToDeleteRecord] = useState(null);
    const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterAction, setFilterAction] = useState('All');
    const [filterDate, setFilterDate] = useState('All Time');

    const uniqueActions = useMemo(() => {
        return ['All', ...new Set(history.map(r => r.action))];
    }, [history]);

    const filteredHistory = useMemo(() => {
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
        const thirtyDaysAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;

        return history.filter(record => {
            const matchesSearch = record.file && record.file.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesFilter = filterAction === 'All' || record.action === filterAction;
            
            let matchesDate = true;
            if (record.date) {
                const recordTime = new Date(record.date).getTime();
                if (filterDate === 'Today') {
                    matchesDate = recordTime >= startOfToday;
                } else if (filterDate === 'Last 7 Days') {
                    matchesDate = recordTime >= sevenDaysAgo;
                } else if (filterDate === 'Last 30 Days') {
                    matchesDate = recordTime >= thirtyDaysAgo;
                }
            }

            return matchesSearch && matchesFilter && matchesDate;
        });
    }, [history, searchTerm, filterAction, filterDate]);

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

    const handleDownload = async (record) => {
        try {
            const localData = await HistoryStore.getLocalData(record.id);
            if (!localData || !localData.data) {
                alert("File data is not available for this record (it may have been created before this feature was added).");
                return;
            }
            if (localData.isBase64 && fromB64) {
                await FileProcessor.downloadBytes({ bytes: fromB64(localData.data), name: record.file, mimeType: localData.mimeType });
            } else if (FileProcessor) {
                await FileProcessor.download({ text: localData.data, name: record.file, mimeType: localData.mimeType });
            } else {
                alert("File processor missing.");
            }
        } catch (e) {
            alert("Error downloading: " + e.message);
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
                    <div className="flex justify-between items-center mb-2">
                        <h3 className="text-xl font-semibold text-slate-200">Activity History</h3>
                        <button
                            onClick={() => setShowDeleteAllConfirm(true)}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-red-700/20 hover:bg-red-700/80 text-red-400 hover:text-white rounded-md text-sm font-medium transition-colors whitespace-nowrap"
                        >
                            <Trash2 size={16} />
                            Delete All
                        </button>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3 items-center w-full">
                        <div className="relative flex-1 w-full">
                            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input 
                                type="text" 
                                placeholder="Search history by file name..." 
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full h-10 bg-slate-900/50 border border-slate-700 text-slate-200 rounded-md pl-10 pr-4 text-sm focus:outline-none focus:border-cyan-500 transition-colors placeholder:text-slate-500"
                            />
                        </div>
                        <div className="flex gap-3 w-full sm:w-auto">
                            <CustomSelect
                                value={filterDate}
                                options={['All Time', 'Today', 'Last 7 Days', 'Last 30 Days']}
                                onChange={setFilterDate}
                                icon={Calendar}
                                label="Date"
                                className="flex-1 sm:w-40"
                            />
                            <CustomSelect
                                value={filterAction}
                                options={uniqueActions}
                                onChange={setFilterAction}
                                icon={Filter}
                                label="Action"
                                className="flex-1 sm:w-48"
                            />
                        </div>
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
                                    {filteredHistory.length === 0 ? (
                                        <tr>
                                            <td colSpan="4" className="px-4 py-8 text-center text-slate-400">
                                                No results match your search or filter.
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredHistory.map((record, i) => (
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
                                                    <div className="flex justify-end gap-2">
                                                        <button
                                                            onClick={() => handleDownload(record)}
                                                            title="Download"
                                                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-cyan-700/20 hover:bg-cyan-700/80 text-cyan-400 hover:text-white rounded-md text-xs font-semibold transition-colors"
                                                        >
                                                            <Download size={13} />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDelete(record)}
                                                            title="Delete Log"
                                                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-red-700/20 hover:bg-red-700/80 text-red-500 hover:text-white rounded-md text-xs font-semibold transition-colors"
                                                        >
                                                            <Trash2 size={13} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                    )}
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