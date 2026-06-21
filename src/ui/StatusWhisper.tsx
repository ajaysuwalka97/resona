type StatusWhisperProps = {
  message: string;
};

export function StatusWhisper({ message }: StatusWhisperProps) {
  return (
    <p className="status-whisper" aria-live="polite">
      {message}
    </p>
  );
}
