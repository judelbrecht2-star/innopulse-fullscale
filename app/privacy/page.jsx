export const metadata = { title: "Privacy notice — InnoPulse Full-Scale" };

export default function Privacy() {
  return (
    <div className="rshell">
      <div style={{ maxWidth: 720, margin: "40px auto", padding: "0 18px" }}>
        <div className="card">
          <h1>Privacy notice — InnoPulse Full-Scale assessments</h1>
          <p className="small muted">The Growth System · policy v0.2 · effective 16 July 2026</p>

          <h2 style={{ fontSize: 16, marginTop: 18 }}>What we collect from respondents</h2>
          <p className="small">
            Your answers to the assessment questions and any written comments you choose to leave.
            We do <b>not</b> collect your name, email address, phone number, IP address or device
            identifiers with your responses. A random technical reference (not linked to your
            identity) lets your own device resume a saved draft and prevents accidental double
            submissions.
          </p>

          <h2 style={{ fontSize: 16, marginTop: 16 }}>How results are used</h2>
          <p className="small">
            Responses are analysed at stakeholder-group level to assess the organisation&apos;s
            innovation health. Group results stay hidden until enough people have responded
            (the campaign&apos;s anonymity threshold, minimum 4). Dashboards and reports never show
            individual results. Individual de-identified answers and written comments are visible
            only to the organisation&apos;s small assessment team for data-quality checks — never to
            managers in reports, and never with any identity attached.
          </p>

          <h2 style={{ fontSize: 16, marginTop: 16 }}>If you receive an email invitation</h2>
          <p className="small">
            Email addresses used to deliver invitations or reminders are used for delivery only.
            They are not stored with responses and cannot be connected to what you answer.
          </p>

          <h2 style={{ fontSize: 16, marginTop: 16 }}>Storage, retention and your rights (POPIA)</h2>
          <p className="small">
            Data is processed by The Growth System as operator for the organisation being assessed,
            and hosted with our infrastructure providers (Supabase/AWS eu-west-1, Vercel). Assessment
            data is retained for the duration of the client engagement plus 24 months for
            cycle-over-cycle comparison, unless the client requests earlier deletion. Because answers
            are stored without identity, we cannot look up or delete a specific person&apos;s responses —
            this is a deliberate privacy protection. For any question or request under the Protection
            of Personal Information Act, contact{" "}
            <a href="mailto:judith@thegrowthsystem.co.za">judith@thegrowthsystem.co.za</a>.
          </p>

          <p className="small muted" style={{ marginTop: 16 }}>
            Workspace users (organisation staff signing in to run campaigns): your account email and
            role are stored to operate the service, protected by row-level security, and never sold
            or shared.
          </p>
        </div>
      </div>
    </div>
  );
}
