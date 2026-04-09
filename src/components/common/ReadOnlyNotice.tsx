interface ReadOnlyNoticeProps {
  message?: string;
  className?: string;
}

export function ReadOnlyNotice({
  message = "Subscription inactive - read-only mode.",
  className = "mb-4",
}: ReadOnlyNoticeProps) {
  return (
    <div className={`${className} app-alert-warning px-3 py-2`}>
      {message}
    </div>
  );
}
