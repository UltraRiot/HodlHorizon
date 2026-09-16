import Seo from "../components/Seo";
import Header from "../components/Header";
import Footer from "../components/Footer";

export default function Contact() {
  return (
    <>
      <Seo
        title="Contact | Hodl Horizon"
        description="Get in touch with Hodl Horizon for corrections, press inquiries, partnership questions, or general feedback about our AI-written finance and crypto coverage."
        path="/contact"
      />
      <Header />
      <main className="container" style={{ maxWidth: 740, padding: "52px 24px 100px" }}>
        <h1 className="serif" style={{ fontSize: 32, fontWeight: 600, margin: "0 0 20px" }}>Contact</h1>
        <p style={{ fontSize: 17, lineHeight: 1.72, color: "var(--text-dim)" }}>
          Questions, corrections, or press inquiries: <a href="mailto:hello@hodlhorizon.com">hello@hodlhorizon.com</a>
          {" "}(placeholder — replace with your real contact address before launch).
        </p>
      </main>
      <Footer />
    </>
  );
}
