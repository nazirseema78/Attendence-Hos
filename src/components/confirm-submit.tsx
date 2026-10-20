"use client";

import type { ComponentProps } from "react";
import { SubmitButton } from "./submit-button";

/** Submit button that asks for confirmation first. */
export function ConfirmSubmit({ message, ...props }: ComponentProps<typeof SubmitButton> & { message: string }) {
  return (
    <SubmitButton
      {...props}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    />
  );
}
