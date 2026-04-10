"use client";

import { useCallback } from "react";
import { useDropzone } from "react-dropzone";

interface CoStarUploadProps {
  file: File | null;
  onFile: (file: File) => void;
  disabled?: boolean;
}

export default function CoStarUpload({ file, onFile, disabled = false }: CoStarUploadProps) {
  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted.length > 0) onFile(accepted[0]);
    },
    [onFile]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    disabled,
  });

  return (
    <div
      {...getRootProps()}
      className={`upload-zone min-h-[180px] flex items-center justify-center ${
        isDragActive ? "drag-active" : ""
      } ${file ? "has-file" : ""} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <input {...getInputProps()} />

      {file ? (
        <div className="flex flex-col items-center gap-2">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
            <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-green-700">{file.name}</p>
          <p className="text-xs text-gray-500">
            {(file.size / 1024 / 1024).toFixed(1)} MB — click or drag to replace
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center">
            <svg
              className="w-7 h-7 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>
          <div className="text-center">
            <p className="font-semibold text-gray-700">
              {isDragActive ? "Drop CoStar PDF here" : "Upload CoStar Report"}
            </p>
            <p className="text-sm text-gray-400 mt-1">
              Drag & drop or click to browse
            </p>
            <p className="text-xs text-gray-300 mt-1">PDF only — CoStar Underwriting Report</p>
          </div>
        </div>
      )}
    </div>
  );
}
