import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors so a single broken screen does not leave a blank page.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[BOAT] ErrorBoundary", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-xl border border-red-200 bg-white p-6 shadow-sm">
            <h1 className="text-lg font-semibold text-slate-900">Something went wrong</h1>
            <p className="mt-2 text-sm text-slate-600">
              The app hit an unexpected error. Try reloading the page. If this keeps happening, contact support with the
              details below.
            </p>
            <pre className="mt-4 max-h-40 overflow-auto rounded-lg bg-slate-100 p-3 text-xs text-red-800 whitespace-pre-wrap break-words">
              {this.state.error.message}
            </pre>
            <button
              type="button"
              className="mt-4 w-full rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800"
              onClick={() => window.location.reload()}
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
