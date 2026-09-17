import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders the heading and an empty list", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Todo" })).toBeInTheDocument();
    expect(screen.getByText("No todos")).toBeInTheDocument();
  });

  it("adds a todo when the form is submitted", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("New todo"), "buy milk");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByText("buy milk")).toBeInTheDocument();
  });

  it("toggles a todo when its checkbox is clicked", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("New todo"), "buy milk");
    await user.click(screen.getByRole("button", { name: "Add" }));

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);
    expect(checkbox).toBeChecked();
  });

  it("shows the remaining count text", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("New todo"), "buy milk");
    await user.click(screen.getByRole("button", { name: "Add" }));

     expect(screen.getByText("1 item left")).toBeInTheDocument();
  });

  it("decrements the remaining count once a todo is completed", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("New todo"), "buy milk");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("checkbox"));

    expect(screen.getByText("0 items left")).toBeInTheDocument();
  });
});
