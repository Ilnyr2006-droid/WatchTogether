import { describe, expect, it, vi } from "vitest";
import { configuredPublicBaseUrl, isPublicIpv4, lookupPublicIpv4 } from "@/server/public-ip";

describe("public IPv4 lookup", () => {
  it("falls back to the second HTTPS service", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("95.123.45.67\n", { status: 200 }));
    expect(await lookupPublicIpv4(fetcher, 100)).toBe("95.123.45.67");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("never accepts LAN, loopback or CGNAT addresses as public", () => {
    expect(isPublicIpv4("192.168.1.10")).toBe(false); expect(isPublicIpv4("127.0.0.1")).toBe(false);
    expect(isPublicIpv4("100.64.1.2")).toBe(false); expect(isPublicIpv4("8.8.8.8")).toBe(true);
  });

  it("uses production PUBLIC_URL for invitation links", () => {
    const previous = process.env.PUBLIC_URL;
    process.env.PUBLIC_URL = "https://watch.khinkaliprime.ru/";
    expect(configuredPublicBaseUrl()).toBe("https://watch.khinkaliprime.ru");
    if (previous === undefined) delete process.env.PUBLIC_URL; else process.env.PUBLIC_URL = previous;
  });
});
