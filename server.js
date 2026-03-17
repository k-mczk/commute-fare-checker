const express = require("express");
const cheerio = require("cheerio");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3456;

app.use(express.static(path.join(__dirname, "public")));

// Yahoo乗換案内から定期代を取得（__NEXT_DATA__ JSONをパース）
app.get("/api/search", async (req, res) => {
  const from = req.query.from;
  const to = req.query.to || "茅場町";
  if (!from) {
    return res.status(400).json({ error: "fromパラメータが必要です" });
  }

  try {
    // type=4: 運賃検索（定期代含む）, ticket=ic: IC運賃
    const url = `https://transit.yahoo.co.jp/search/result?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&type=4&ticket=ic&s=0`;

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`Yahoo Transit responded with ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // __NEXT_DATA__ からJSONを取得
    const nextDataScript = $("#__NEXT_DATA__");
    if (!nextDataScript.length) {
      return res.json({ from, to, routes: [], suggestions: [], yahooUrl: url, error: "ページの解析に失敗しました" });
    }

    const nextData = JSON.parse(nextDataScript.html());
    const pageProps = nextData?.props?.pageProps;
    const queryState = pageProps?.queryState;

    // エラーチェック
    if (queryState?.errorList?.length > 0) {
      return res.json({
        from, to, routes: [], suggestions: [],
        yahooUrl: url,
        error: queryState.errorList.join(", "),
      });
    }

    // 候補駅（曖昧検索時）
    const candidateInfo = pageProps?.candidateInfo;
    if (candidateInfo) {
      const suggestions = [];
      if (candidateInfo.fromCandidate) {
        candidateInfo.fromCandidate.forEach(c => {
          if (c.name) suggestions.push(c.name);
        });
      }
      if (suggestions.length > 0) {
        return res.json({ from, to, routes: [], suggestions, yahooUrl: url });
      }
    }

    // ルート情報を取得（featureInfoList は naviSearchParam 直下）
    const featureList = pageProps?.naviSearchParam?.featureInfoList || [];
    const routes = [];

    featureList.forEach((feature, i) => {
      const summary = feature.summaryInfo;
      if (!summary) return;

      const route = {
        index: i + 1,
        month1: null,
        month3: null,
        month6: null,
        stations: [],
        lines: [],
        totalTime: summary.totalTime || "",
        transferCount: summary.transferCount || "0",
        fare: summary.totalPrice || "",
      };

      // 定期代
      if (summary.teiki && summary.teiki.length > 0) {
        summary.teiki.forEach(t => {
          if (t.month === "1") route.month1 = t.price + "円";
          if (t.month === "3") route.month3 = t.price + "円";
          if (t.month === "6") route.month6 = t.price + "円";
        });
      }

      // 経路詳細（edgeInfoList から駅名・路線名を取得）
      const edges = feature.edgeInfoList || [];
      edges.forEach(edge => {
        if (edge.stationName) {
          if (!route.stations.includes(edge.stationName)) {
            route.stations.push(edge.stationName);
          }
        }
        if (edge.railNameExcludingDestination) {
          const lineName = edge.railNameExcludingDestination;
          if (!route.lines.includes(lineName)) {
            route.lines.push(lineName);
          }
        }
      });

      if (route.month1) {
        routes.push(route);
      }
    });

    res.json({
      from,
      to,
      routes,
      suggestions: [],
      yahooUrl: url,
    });
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "検索中にエラーが発生しました", detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
