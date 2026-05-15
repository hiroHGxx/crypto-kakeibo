import { NextRequest, NextResponse } from "next/server";
import { generateExcel } from "@/lib/excel-generator";
import { buildExportEntries } from "@/lib/export-pipeline";

export async function POST(request: NextRequest) {
  try {
    // multipart/form-data か JSON か判定
    const contentType = request.headers.get("content-type") || "";
    let address: string | undefined;
    let secondaryAddress: string | undefined;
    let addresses: string[] | undefined;
    let year: number | undefined;
    let importedFileBuffer: Buffer | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const addressesField = form.get("addresses");
      if (typeof addressesField === "string") {
        try {
          const parsed = JSON.parse(addressesField);
          if (Array.isArray(parsed)) addresses = parsed;
        } catch {
          addresses = [addressesField];
        }
      }
      const yearField = form.get("year");
      if (yearField) year = parseInt(String(yearField));
      address = (form.get("address") as string) || undefined;
      secondaryAddress = (form.get("secondaryAddress") as string) || undefined;

      const file = form.get("importExcel");
      if (file && file instanceof File && file.size > 0) {
        const arrayBuf = await file.arrayBuffer();
        importedFileBuffer = Buffer.from(arrayBuf);
      }
    } else {
      const body = await request.json();
      address = body.address;
      secondaryAddress = body.secondaryAddress;
      addresses = body.addresses;
      year = body.year;
    }

    const targetAddresses = (
      Array.isArray(addresses) ? addresses : [address, secondaryAddress]
    )
      .filter(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0
      )
      .map((value) => value.trim());

    if (targetAddresses.length === 0) {
      return NextResponse.json(
        { error: "ウォレットアドレスが必要です（1件以上）" },
        { status: 400 }
      );
    }

    const { entries } = await buildExportEntries({
      targetAddresses,
      year,
      importExcelBuffer: importedFileBuffer,
    });

    const buffer = await generateExcel(entries, year || new Date().getFullYear());

    const fileName = `確定申告${year || new Date().getFullYear()}仮想通貨.xlsx`;

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
      },
    });
  } catch (error) {
    console.error("Export Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Excel出力に失敗しました" },
      { status: 500 }
    );
  }
}
