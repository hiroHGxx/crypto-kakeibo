"use client";

import { useState } from "react";

export default function Home() {
  const [address, setAddress] = useState("0x01b27ec780c534ba0fab15509354c3798321273c");
  const [secondaryAddress, setSecondaryAddress] = useState("0x581087E117A68537b624e0352833dB96654c0481");
  const [year, setYear] = useState("2024");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string>("");

  const handleFetch = async () => {
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/transactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          addresses: [address, secondaryAddress].filter((value) => value.trim().length > 0),
          year: parseInt(year),
        }),
      });

      if (!response.ok) {
        throw new Error("データ取得に失敗しました");
      }

      const data = await response.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setError("");

    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          addresses: [address, secondaryAddress].filter((value) => value.trim().length > 0),
          year: parseInt(year),
        }),
      });

      if (!response.ok) {
        throw new Error("Excel出力に失敗しました");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `確定申告${year}ETH.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-gray-900 mb-8 text-center">
          仮想通貨取引履歴取得（ETH）
        </h1>

        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                メインウォレットアドレス
              </label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="0x..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                セカンドウォレットアドレス
              </label>
              <input
                type="text"
                value={secondaryAddress}
                onChange={(e) => setSecondaryAddress(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="0x..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                対象年
              </label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="2024"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={handleFetch}
                disabled={loading || exporting}
                className="bg-blue-600 text-white py-3 px-6 rounded-md font-medium hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? "取得中..." : "取引履歴を取得"}
              </button>
              <button
                onClick={handleExport}
                disabled={loading || exporting}
                className="bg-green-600 text-white py-3 px-6 rounded-md font-medium hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {exporting ? "出力中..." : "Excelダウンロード"}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md mb-6">
            {error}
          </div>
        )}

        {result && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-2xl font-bold mb-4">取得結果</h2>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-blue-50 p-4 rounded">
                <div className="text-sm text-gray-600">通常トランザクション</div>
                <div className="text-2xl font-bold text-blue-600">
                  {result.transactions?.length || 0}件
                </div>
              </div>
              <div className="bg-green-50 p-4 rounded">
                <div className="text-sm text-gray-600">Internal TX</div>
                <div className="text-2xl font-bold text-green-600">
                  {result.internalTxs?.length || 0}件
                </div>
              </div>
              <div className="bg-purple-50 p-4 rounded">
                <div className="text-sm text-gray-600">トークン転送</div>
                <div className="text-2xl font-bold text-purple-600">
                  {result.tokenTransfers?.length || 0}件
                </div>
              </div>
              <div className="bg-pink-50 p-4 rounded">
                <div className="text-sm text-gray-600">NFT転送</div>
                <div className="text-2xl font-bold text-pink-600">
                  {result.nftTransfers?.length || 0}件
                </div>
              </div>
            </div>

            <details className="mt-4">
              <summary className="cursor-pointer text-blue-600 hover:text-blue-800 font-medium">
                詳細データを表示（JSON）
              </summary>
              <pre className="mt-4 bg-gray-50 p-4 rounded overflow-auto text-xs max-h-96">
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
