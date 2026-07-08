import {
  MIN_DIALS_FOR_EVAL,
  computeAnswerRate,
  classifyNumber,
  evaluateAlertTransition,
  formatReputationAlertCopy,
  median,
} from "@/lib/reputation/numberReputation";

describe("number reputation pure logic", () => {
  test("computeAnswerRate excludes voicemail from denominator", () => {
    expect(computeAnswerRate({ completed: 5, voicemail: 5, total: 10 })).toBe(100);
  });

  test("classifyNumber returns insufficient_data below 30 dials", () => {
    const result = classifyNumber({
      answerRate: 5,
      shortCallRate: 0,
      peerMedian: 40,
      dials: MIN_DIALS_FOR_EVAL - 1,
      fleetSize: 5,
    });
    expect(result.tier).toBe("insufficient_data");
  });

  test("healthy-but-low steady answer rate near peer baseline is healthy", () => {
    const result = classifyNumber({
      answerRate: 12,
      priorAnswerRate: 12,
      shortCallRate: 0,
      peerMedian: 11,
      dials: 100,
      fleetSize: 3,
    });
    expect(result.tier).toBe("healthy");
  });

  test("steady telesales fleet around 10-12% stays healthy across the batch", () => {
    const fleet = [
      { answerRate: 10, priorAnswerRate: 10 },
      { answerRate: 11, priorAnswerRate: 11 },
      { answerRate: 12, priorAnswerRate: 12 },
      { answerRate: 11, priorAnswerRate: 11 },
    ];
    const peerMedian = median(fleet.map((number) => number.answerRate));

    const results = fleet.map((number) =>
      classifyNumber({
        answerRate: number.answerRate,
        priorAnswerRate: number.priorAnswerRate,
        shortCallRate: 0,
        peerMedian,
        dials: 100,
        fleetSize: fleet.length,
      }),
    );

    expect(results.map((result) => result.tier)).toEqual([
      "healthy",
      "healthy",
      "healthy",
      "healthy",
    ]);
    expect(results.filter((result) => result.tier !== "healthy")).toHaveLength(0);
  });

  test("12% to 3% number below peer median is spam_risk", () => {
    const result = classifyNumber({
      answerRate: 3,
      priorAnswerRate: 12,
      shortCallRate: 0,
      peerMedian: 20,
      dials: 100,
      fleetSize: 3,
    });
    expect(result.tier).toBe("spam_risk");
  });

  test("watch copy never carries replacement language", () => {
    const copy = formatReputationAlertCopy({
      tier: "watch",
      formattedNumber: "(555) 123-4567",
    });
    expect(copy).toContain("Heads up");
    expect(copy.toLowerCase()).not.toContain("replacing");
    expect(copy.toLowerCase()).not.toContain("replace");
  });

  test("edge-triggered alert fires once then not again until cleared", () => {
    expect(
      evaluateAlertTransition({
        previousTier: "healthy",
        nextTier: "watch",
        lastAlertTier: "",
      }).shouldAlert,
    ).toBe(true);

    expect(
      evaluateAlertTransition({
        previousTier: "watch",
        nextTier: "watch",
        lastAlertTier: "watch",
      }).shouldAlert,
    ).toBe(false);

    const clear = evaluateAlertTransition({
      previousTier: "watch",
      nextTier: "healthy",
      lastAlertTier: "watch",
    });
    expect(clear.shouldAlert).toBe(false);
    expect(clear.shouldClearAlertState).toBe(true);

    expect(
      evaluateAlertTransition({
        previousTier: "healthy",
        nextTier: "watch",
        lastAlertTier: "",
      }).shouldAlert,
    ).toBe(true);
  });
});
