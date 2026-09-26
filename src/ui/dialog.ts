export interface DialogState {
  title?: string;
  message: string;
  detail?: string;
}

export function createErrorDialog(
  message: string,
  title: string = "Error",
  detail?: string,
): DialogState {
  return {
    title,
    message,
    detail,
  };
}
