"use client";

import { useCallback } from "react";
import { useDropzone } from "react-dropzone";

interface UploadStepProps {
  onFile: (file: File) => void;
  loading: boolean;
  error: string | null;
}

const ACCEPT = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "text/csv": [".csv"],
};

export default function UploadStep({ onFile, loading, error }: UploadStepProps) {
  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted.length > 0) onFile(accepted[0]);
    },
    [onFile]
  );

  const { getRootProps, getInputProps, isDragActive, acceptedFiles } = useDropzone({
    onDrop,
    accept: ACCEPT,
    maxFiles: 1,
    disabled: loading,
  });

  const file = acceptedFiles[0] ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-semibold text-navy-800">Upload Rent Roll</p>
        <p className="text-xs text-gray-500 mt-0.5">
          Yardi exports are parsed directly. All other XLSX and CSV formats are mapped with AI.
        </p>
      </div>

      <div
        {...getRootProps()}
        className={`upload-zone ${isDragActive ? "drag-active" : ""} ${file && !loading ? "has-file" : ""} ${loading ? "opacity-60 cursor-not-allowed" : ""}`}
      >
        <input {...getInputProps()} />

        {loading ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 bg-navy-100 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-navy-600 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-navy-700">Processing file…</p>
              <p className="text-xs text-gray-400 mt-0.5">Detecting format and parsing rent roll</p>
            </div>
          </div>
        ) : file ? (
          <div className="flex flex-col items-center gap-2">
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-green-700 truncate max-w-full px-2">{file.name}</p>
            <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(0)} KB — click to replace</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-gray-700 text-sm">
                {isDragActive ? "Drop file here" : "Drag & drop or click to browse"}
              </p>
              <p className="text-xs text-gray-400 mt-1">XLSX, CSV</p>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-xs font-semibold text-red-700">Upload failed</p>
          <p className="text-xs text-red-600 mt-0.5">{error}</p>
        </div>
      )}
    </div>
  );
}
