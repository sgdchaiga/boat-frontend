interface AccessDeniedNoticeProps {
  message?: string;
  className?: string;
}

export function AccessDeniedNotice({
  message = "Access denied for this module.",
  className = "mx-6 mt-6",
}: AccessDeniedNoticeProps) {
  return (
    <div className={`${className} app-alert-error px-3 py-2`}>
      {message}
    </div>
  );
}
