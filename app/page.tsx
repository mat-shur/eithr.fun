export default function HomePage() {
  return (
    <section  className="pt-50">
      <div className="w-full max-w-6xl mx-auto">
        <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500 mb-10">
          On-chain prediction playground
        </p>

        <div className="leading-none">
          <h1 className="flex items-baseline gap-2 leading-none">
            <span className="text-[16vw] md:text-[11vw] font-medium">
              eithr
            </span>

            <span
              className="
                text-[10vw] md:text-[7vw] font-semibold
                bg-gradient-to-r
                from-[#9945FF] via-[#14F195] to-[#00C2FF]
                bg-clip-text text-transparent
                tracking-tight
              "
            >
              .fun
            </span>
          </h1>

          <div className="mt-4 pt-6 border-t-2 border-gray-900/70 flex flex-col md:flex-row md:items-start md:justify-between gap-10">
            <p className="text-2xl md:text-3xl lg:text-2xl font-medium max-w-xl">
              Tiny lightful memecoin-like prediction battles.
            </p>

            <div className="max-w-sm text-[13px] leading-relaxed text-zinc-400 space-y-3">
              <p>
                This is where you spin up tiny on-chain face-off
                and whatever else the internet is arguing about.
              </p>
              <p>
                Pick a side, buy side tickets and when the timer hits zero,
                the bigger crowd splits a share of the losing side’s pool.
              </p>
              <p className="text-[10px] pt-10 uppercase tracking-[0.22em] text-zinc-500">
              · Not financial advice ·
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
