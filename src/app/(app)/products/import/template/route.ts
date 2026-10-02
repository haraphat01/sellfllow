import { CSV_TEMPLATE } from "@/lib/products/csv";

export function GET() {
  return new Response(CSV_TEMPLATE + "\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="sellflow-products-template.csv"',
    },
  });
}
