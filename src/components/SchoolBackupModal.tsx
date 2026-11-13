import React, { useState, useEffect, useRef } from 'react';
import {
  Database,
  Download,
  Upload,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Clock,
  FileText,
  AlertTriangle,
  X,
  HardDrive,
  Cloud,
  FileCheck
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { apiRequest, getStoredToken } from '../api';
import { syncSchoolToFirestore, getFirebaseSyncStatus, restoreSchoolFromFirestore, CloudSyncStatus } from '../utils/firebaseSync';

interface SchoolBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  schoolId: string;
  schoolName: string;
  isSuperAdmin?: boolean;
  onRestored?: () => void;
}

export const SchoolBackupModal: React.FC<SchoolBackupModalProps> = ({
  isOpen,
  onClose,
  schoolId,
  schoolName,
  isSuperAdmin = false,
  onRestored,
}) => {
  const [activeTab, setActiveTab] = useState<'backup' | 'restore' | 'cloud'>('backup');
  const [downloading, setDownloading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Cloud status state
  const [cloudStatus, setCloudStatus] = useState<CloudSyncStatus | null>(null);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [syncingCloud, setSyncingCloud] = useState(false);
  const [restoringCloud, setRestoringCloud] = useState(false);

  // File restore state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedBackup, setParsedBackup] = useState<any | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [restoringFile, setRestoringFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && schoolId) {
      loadCloudSyncInfo();
    }
  }, [isOpen, schoolId]);

  const loadCloudSyncInfo = async () => {
    if (!schoolId) return;
    setCloudLoading(true);
    try {
      const status = await getFirebaseSyncStatus(schoolId);
      setCloudStatus(status);
    } catch (err: any) {
      console.warn('Could not load cloud sync status:', err);
    } finally {
      setCloudLoading(false);
    }
  };

  if (!isOpen) return null;

  // 1. Download Backup JSON
  const handleDownloadBackup = async () => {
    setDownloading(true);
    setStatusMsg(null);
    try {
      const token = getStoredToken() || '';
      const url = isSuperAdmin
        ? `/api/admin/schools/${schoolId}/backup-download`
        : `/api/school/download-backup?school_id=${encodeURIComponent(schoolId)}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Download failed with status ${res.status}`);
      }

      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;

      const safeName = (schoolName || 'School').replace(/[^a-zA-Z0-9_-]/g, '_');
      const timestamp = new Date().toISOString().slice(0, 10);
      a.download = `${safeName}_Full_Database_Backup_${timestamp}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);

      confetti({ particleCount: 50, spread: 60 });
      setStatusMsg({
        type: 'success',
        text: `Backup downloaded successfully! Keep this file safe for instant disaster recovery.`
      });
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: 'Backup download error: ' + err.message
      });
    } finally {
      setDownloading(false);
    }
  };

  // 2. Handle File Selection for Restore
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setParseError(null);
    setParsedBackup(null);

    try {
      const text = await file.text();
      const json = JSON.parse(text);
      if (!json || (!json.school && !json.students)) {
        throw new Error('This file is not a valid AcademiQ School Backup archive.');
      }
      setParsedBackup(json);
    } catch (err: any) {
      setParseError(err.message || 'Failed to read backup file JSON.');
      setSelectedFile(null);
    }
  };

  // 3. Execute File Restore
  const handleExecuteFileRestore = async () => {
    if (!parsedBackup) return;
    if (!confirm(`Are you sure you want to restore '${schoolName}' from this backup file? Existing records will be updated and recovered.`)) {
      return;
    }

    setRestoringFile(true);
    setStatusMsg(null);
    try {
      const token = getStoredToken() || '';
      const endpoint = isSuperAdmin
        ? `/api/admin/schools/${schoolId}/restore`
        : `/api/school/import-cloud-data`;

      const res = await apiRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify({ schoolData: parsedBackup, backupData: parsedBackup })
      });

      confetti({ particleCount: 75, spread: 70 });
      setStatusMsg({
        type: 'success',
        text: res.message || `Successfully restored ${schoolName} with zero data loss!`
      });
      setSelectedFile(null);
      setParsedBackup(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      onRestored?.();
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: 'Restore failed: ' + (err.message || 'Please verify backup file structure.')
      });
    } finally {
      setRestoringFile(false);
    }
  };

  // 4. Cloud Sync
  const handleCloudSync = async () => {
    setSyncingCloud(true);
    setStatusMsg(null);
    try {
      const token = getStoredToken() || '';
      const res = await syncSchoolToFirestore(schoolId, token);
      confetti({ particleCount: 60 });
      setStatusMsg({
        type: 'success',
        text: `Cloud Backup Created! Synced ${res.totalSynced.students} students, ${res.totalSynced.scores} scores, and academic records to Secure Cloud Vault.`
      });
      loadCloudSyncInfo();
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: 'Cloud Backup Error: ' + (err.message || 'Failed to sync to cloud vault.')
      });
    } finally {
      setSyncingCloud(false);
    }
  };

  // 5. Cloud Restore
  const handleCloudRestore = async () => {
    if (!confirm(`Restore '${schoolName}' from the latest secure cloud backup? This will rollback any mistaken updates.`)) {
      return;
    }

    setRestoringCloud(true);
    setStatusMsg(null);
    try {
      const token = getStoredToken() || '';
      const res = await restoreSchoolFromFirestore(schoolId, token);
      confetti({ particleCount: 70 });
      setStatusMsg({
        type: 'success',
        text: res.message || 'Restored successfully from Cloud Backup snapshot!'
      });
      onRestored?.();
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: 'Cloud Rollback Error: ' + (err.message || 'Failed to restore from cloud snapshot.')
      });
    } finally {
      setRestoringCloud(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="px-6 py-5 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-300 flex items-center justify-center border border-emerald-400/30">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold">School Database Backup & Disaster Recovery</h2>
                {isSuperAdmin && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                    Super Admin Oversight
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-300">
                School: <strong className="text-white">{schoolName}</strong> (ID: {schoolId})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Controls */}
        <div className="flex border-b border-slate-200 bg-slate-50/70 px-6 pt-3 gap-2">
          <button
            onClick={() => setActiveTab('backup')}
            className={`pb-2.5 px-3 text-xs font-bold transition border-b-2 flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'backup'
                ? 'border-blue-600 text-blue-600 bg-white rounded-t-xl'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>Create & Download Backup</span>
          </button>

          <button
            onClick={() => setActiveTab('restore')}
            className={`pb-2.5 px-3 text-xs font-bold transition border-b-2 flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'restore'
                ? 'border-blue-600 text-blue-600 bg-white rounded-t-xl'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Upload className="w-3.5 h-3.5 text-amber-600" />
            <span>Restore from File (Rollback)</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('cloud');
              loadCloudSyncInfo();
            }}
            className={`pb-2.5 px-3 text-xs font-bold transition border-b-2 flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'cloud'
                ? 'border-blue-600 text-blue-600 bg-white rounded-t-xl'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Cloud className="w-3.5 h-3.5 text-indigo-600" />
            <span>Secure Cloud Vault</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {statusMsg && (
            <div
              className={`p-3.5 rounded-2xl border text-xs font-semibold flex items-center justify-between gap-3 ${
                statusMsg.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}
            >
              <div className="flex items-center gap-2">
                {statusMsg.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                )}
                <span>{statusMsg.text}</span>
              </div>
              <button onClick={() => setStatusMsg(null)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>
          )}

          {/* TAB 1: DOWNLOAD BACKUP */}
          {activeTab === 'backup' && (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-2xl text-xs text-emerald-950 space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-emerald-900">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>Zero-Data-Loss School Database Backup</span>
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Export a complete JSON snapshot of {schoolName}. If you or your staff make an error during an update, you can upload this backup file at any time to instantly restore all student data, classes, continuous assessment scores, published broadsheets, fees, and attendance records.
                </p>
              </div>

              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2 text-xs text-slate-700">
                <span className="font-bold text-slate-900 block">Contents Protected in this Backup:</span>
                <div className="grid grid-cols-2 gap-2 text-slate-600">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>All Students & Admission PINs</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Curriculum Classes & Arms</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>CA1, CA2, CA3 & Exam Scores</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Terminal Broadsheet Rankings</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Teacher & Staff Logins</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Attendance & Fee Payments</span>
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <button
                  onClick={handleDownloadBackup}
                  disabled={downloading}
                  className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-2xl text-xs transition shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <Download className={`w-4 h-4 ${downloading ? 'animate-bounce' : ''}`} />
                  <span>{downloading ? 'Generating Backup File...' : 'Download School Database Backup (.json)'}</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: RESTORE FROM FILE */}
          {activeTab === 'restore' && (
            <div className="space-y-4">
              <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-2xl text-xs text-amber-950 space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-amber-900">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span>Restore School from a Previously Downloaded Backup</span>
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Mistakenly deleted students, corrupted broadsheets, or made an error during a software update? Upload your previously saved <code className="bg-amber-100 text-amber-800 px-1 py-0.5 rounded font-mono">.json</code> backup to safely recover this school without affecting other institutions.
                </p>
              </div>

              {/* Upload Dropzone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className="p-6 border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-2xl text-center cursor-pointer transition bg-slate-50/50 hover:bg-blue-50/30 space-y-2"
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".json,application/json"
                  className="hidden"
                />
                <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto border border-blue-200">
                  <Upload className="w-6 h-6" />
                </div>
                <div>
                  <span className="text-xs font-bold text-slate-800 block">
                    {selectedFile ? selectedFile.name : 'Click to select Backup JSON file'}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Supports .json files exported from AcademiQ School Backup
                  </span>
                </div>
              </div>

              {parseError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-semibold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{parseError}</span>
                </div>
              )}

              {/* Backup File Inspection Preview */}
              {parsedBackup && (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-900 border-b border-slate-200 pb-2">
                    <span className="flex items-center gap-1.5 text-blue-700">
                      <FileCheck className="w-4 h-4 text-emerald-600" />
                      <span>Backup File Verified</span>
                    </span>
                    <span className="text-slate-500 font-mono text-[11px]">
                      Exported: {parsedBackup.exportedAt ? new Date(parsedBackup.exportedAt).toLocaleString() : 'N/A'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                    <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Students</span>
                      <span className="text-base font-black text-slate-900 block">
                        {Array.isArray(parsedBackup.students) ? parsedBackup.students.length : 0}
                      </span>
                    </div>

                    <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Classes</span>
                      <span className="text-base font-black text-slate-900 block">
                        {Array.isArray(parsedBackup.classes) ? parsedBackup.classes.length : 0}
                      </span>
                    </div>

                    <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Scores / Marks</span>
                      <span className="text-base font-black text-slate-900 block">
                        {Array.isArray(parsedBackup.student_scores) ? parsedBackup.student_scores.length : 0}
                      </span>
                    </div>

                    <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Staff / Users</span>
                      <span className="text-base font-black text-slate-900 block">
                        {Array.isArray(parsedBackup.users) ? parsedBackup.users.length : 0}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={handleExecuteFileRestore}
                    disabled={restoringFile}
                    className="w-full py-3.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-2xl text-xs transition shadow-md shadow-amber-500/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <Upload className={`w-4 h-4 ${restoringFile ? 'animate-spin' : ''}`} />
                    <span>{restoringFile ? 'Restoring School Records...' : `Confirm & Restore '${schoolName}' from Backup`}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: CLOUD SYNC & ROLLBACK */}
          {activeTab === 'cloud' && (
            <div className="space-y-4">
              <div className="p-4 bg-indigo-50/70 border border-indigo-200 rounded-2xl text-xs text-indigo-950 space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-indigo-900">
                  <Cloud className="w-4 h-4 text-indigo-600" />
                  <span>Automated Cloud Redundancy Storage</span>
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Live encrypted cloud replica for {schoolName}. Backing up stores a complete academic snapshot in cloud storage. If a local machine crashes or data is mistakenly wiped, you can restore from this cloud snapshot with 1 click.
                </p>
              </div>

              {/* Status Display */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">Cloud Backup Status:</span>
                  {cloudLoading ? (
                    <span className="text-slate-500">Checking cloud...</span>
                  ) : cloudStatus?.isSynced ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      Active Cloud Backup
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">
                      <Clock className="w-3.5 h-3.5 text-amber-600" />
                      No Cloud Snapshot Found
                    </span>
                  )}
                </div>

                {cloudStatus?.lastSyncTimestamp && (
                  <div className="text-slate-600 flex items-center justify-between text-[11px] pt-1 border-t border-slate-200">
                    <span>Last Cloud Sync:</span>
                    <strong className="text-slate-800">{new Date(cloudStatus.lastSyncTimestamp).toLocaleString()}</strong>
                  </div>
                )}

                {cloudStatus?.totalRecords ? (
                  <div className="text-slate-600 flex items-center justify-between text-[11px]">
                    <span>Total Records Protected:</span>
                    <strong className="text-emerald-700">{cloudStatus.totalRecords} records</strong>
                  </div>
                ) : null}
              </div>

              {/* Actions */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <button
                  onClick={handleCloudSync}
                  disabled={syncingCloud}
                  className="py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl text-xs transition flex items-center justify-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${syncingCloud ? 'animate-spin' : ''}`} />
                  <span>{syncingCloud ? 'Syncing to Cloud...' : 'Backup to Cloud Vault'}</span>
                </button>

                <button
                  onClick={handleCloudRestore}
                  disabled={restoringCloud || !cloudStatus?.isSynced}
                  className="py-3 bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 font-bold rounded-2xl text-xs transition flex items-center justify-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
                  title={!cloudStatus?.isSynced ? 'No cloud backup available to restore' : 'Rollback school data from cloud snapshot'}
                >
                  <Upload className={`w-4 h-4 text-amber-600 ${restoringCloud ? 'animate-spin' : ''}`} />
                  <span>{restoringCloud ? 'Restoring from Cloud...' : 'Rollback from Cloud Snapshot'}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-1.5 text-emerald-700 font-medium">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Multi-Tenant Data Isolation: Strict single-school boundary</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold rounded-xl text-xs transition cursor-pointer"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
};
