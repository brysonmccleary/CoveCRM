import type { VeteranMasterPreview } from "@/lib/facebook/veteran24MasterReview";
import styles from "@/styles/Veteran24MasterReview.module.css";

export function Veteran24MasterReviewCard({ preview }: { preview: VeteranMasterPreview }) {
  const isImage = preview.mode === "IMAGE_VARIANT" && Boolean(preview.imageUrl);
  return (
    <div
      className={`${styles.creative} ${styles[preview.layout]} ${styles[preview.palette]} ${isImage ? styles.imageMode : ""}`}
      data-veteran-master-preview="true"
      data-master-id={preview.masterId}
      data-mode={preview.mode}
      data-hero-kind={preview.heroKind}
      data-owner-approval-status={preview.ownerApprovalStatus}
      data-deployed="false"
      data-image-compatible={String(preview.imageCompatible)}
      data-background-treatment={isImage ? preview.imageTreatment : "none"}
    >
      <div className={styles.photo}>
        {isImage ? <img
          alt=""
          aria-hidden="true"
          data-creative-photo="true"
          data-creative-photo-src={preview.imageUrl}
          src={preview.imageUrl}
          style={{ display: "block", height: "100%", objectFit: "cover", objectPosition: preview.imageFocalPosition || "center", width: "100%" }}
        /> : null}
      </div>
      <div className={styles.overlay} />
      <div className={styles.texture} />
      <div className={styles.frame} />

      <section className={styles.top} data-region="top">
        <div className={styles.eyebrow} data-audience="true">{preview.eyebrow}</div>
        <div className={styles.headline} data-headline="true">
          {preview.headline.map((line) => <div key={line}>{line}</div>)}
        </div>
        <div className={styles.subhead}>{preview.subhead}</div>
      </section>

      <section className={styles.hero} data-region="hero">
        <div className={styles.heroLabel}>{preview.heroKind === "amount" ? preview.capabilityHeroLabel : "PRIVATE COVERAGE REVIEW"}</div>
        <div className={styles.heroValue} data-hero-value="true">
          {preview.hero.map((line) => <div key={line}>{line}</div>)}
        </div>
      </section>

      <section className={styles.benefits} data-region="benefits">
        {preview.benefits.map((benefit, index) => (
          <div className={styles.benefit} data-benefit-index={index + 1} key={benefit}>
            <span className={styles.benefitIcon}>{["✚", "▥", "⬟", "✓"][index % 4]}</span>
            <span>{benefit}</span>
          </div>
        ))}
      </section>

      <section className={styles.age} data-region="age">
        <div className={styles.cta}>{preview.cta}</div>
        <div className={styles.ageGrid}>
          {preview.ageOptions.map((option) => <div className={styles.ageOption} data-age-option="true" key={option}>{option}</div>)}
        </div>
      </section>
    </div>
  );
}
