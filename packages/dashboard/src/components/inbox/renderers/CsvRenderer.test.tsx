import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CsvRenderer, parseCsv } from "./CsvRenderer";

describe("CsvRenderer", () => {
  it("parses multiline and escaped quoted fields", () => {
    expect(parseCsv('name,notes\r\nAda,"line one\r\nline ""two"""\r\n')).toEqual({
      headers: ["name", "notes"],
      rows: [["Ada", 'line one\r\nline "two"']],
    });
  });

  it("keeps columns with duplicate headings distinct", () => {
    render(<CsvRenderer content={"name,name\nfirst,second"} />);

    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
  });
});
