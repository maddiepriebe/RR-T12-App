"use client";

import { useCallback } from "react";
import { useDropzone } from "react-dropzone";

interface UploadZoneProps {
  label: string;
  sublabel?: string;
  accept?: Record<string, string[]>;
  file: File | null;
  onFile: (file: File) => void;
  disabled?: boolean;
}

const DEFAULT_ACCEPT = {
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.ms-excel": [".xls"],
  "text/csv": [".csv"],
};

export default function UploadZone({
  label,
  sublabel,
  accept = DEFAULT_ACCEPT,
  file,
  onFile,
  disabled = false,
}: UploadZoneProps) {
  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted.length > 0) onFile(accepted[0]);
    },
    [onFile]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept,
    maxFiles: 1,
    disabled,
  });

  return (
    <div
      {...getRootProps()}
      className={`upload-zone ${isDragActive ? "drag-active" : ""} ${file ? "has-file" : ""} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <input {...getInputProps()} />

      {file ? (
        <div className="flex flex-col items-center gap-2">
          <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
            <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-green-700 truncate max-w-full px-2">
            {file.name}
          </p>
          <p className="text-xs text-gray-500">
            {(file.size / 1024).toFixed(0)} KB — click to replace
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-gray-700 text-sm">{label}</p>
            {sublabel && <p className="text-xs text-gray-400 mt-0.5">{sublabel}</p>}
            <p className="text-xs text-gray-400 mt-1">
              {isDragActive ? "Drop file here" : "Drag & drop or click to browse"}
            </p>
            <p className="text-xs text-gray-300 mt-0.5">XLSX, XLS, CSV, PDF</p>
          </div>
        </div>
      )}
    </div>
  );
}
