const cheerio = require("cheerio");

module.exports = async function handler(req, res) {
  const from = req.query.from;
  const to = req.query.to;
  if (!from || !to) {
    return res.status(400).json({ error: "from・toパラメータが必要です" });
  }

  try {
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

    const nextDataScript = $("#__NEXT_DATA__");
    if (!nextDataScript.length) {
      return res.json({ from, to, routes: [], suggestions: [], yahooUrl: url, error: "ページの解析に失敗しました" });
    }

    const nextData = JSON.parse(nextDataScript.html());
    const pageProps = nextData?.props?.pageProps;
    const queryState = pageProps?.queryState;

    if (queryState?.errorList?.length > 0) {
      return res.json({
        from, to, routes: [], suggestions: [],
        yahooUrl: url,
        error: queryState.errorList.join(", "),
      });
    }

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

      if (summary.teiki && summary.teiki.length > 0) {
        summary.teiki.forEach(t => {
          if (t.month === "1") route.month1 = t.price + "円";
          if (t.month === "3") route.month3 = t.price + "円";
          if (t.month === "6") route.month6 = t.price + "円";
        });
      }

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
};
