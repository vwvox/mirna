import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MirnaWordmark } from "./mirna-wordmark";

describe("MirnaWordmark", () => {
  afterEach(() => {
    cleanup();
  });

  it("reads as one accessible name with the ipê dot replacing the i's dot", () => {
    render(<MirnaWordmark />);

    const wordmark = screen.getByRole("img", { name: "Mirna" });
    expect(wordmark.textContent).toBe("mırna");
    expect(wordmark.querySelector(".bg-mirna-ipe")).not.toBeNull();
    expect(wordmark.querySelectorAll("path")).toHaveLength(3);
    expect(wordmark.querySelector(".stroke-mirna-terra")).not.toBeNull();
  });

  it("can drop the mist line", () => {
    render(<MirnaWordmark mist={false} />);

    expect(
      screen.getByRole("img", { name: "Mirna" }).querySelector("svg"),
    ).toBeNull();
  });
});
