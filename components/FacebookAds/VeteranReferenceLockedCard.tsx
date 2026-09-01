import type { VeteranReferencePreview } from "@/lib/facebook/veteranReferenceLocked12";
import styles from "@/styles/VeteranReferenceLocked.module.css";

const icons = ["♙", "▥", "⬟", "✓"];

export function VeteranReferenceLockedCard({ preview }: { preview: VeteranReferencePreview }) {
  const imageMode = Boolean(preview.imageUrl);
  return <div
    className={`${styles.creative} ${styles[preview.layout]} ${styles[preview.palette]} ${imageMode ? styles.imageMode : ""}`}
    data-reference-locked-preview="true"
    data-master-id={preview.masterId}
    data-mode={preview.mode}
    data-hero-kind={preview.heroKind}
    data-owner-approval-status={preview.ownerApprovalStatus}
    data-deployed="false"
    data-background-treatment={imageMode ? preview.imageTreatment : "none"}
  >
    <div className={styles.photo} style={imageMode ? {backgroundImage:`url("${preview.imageUrl}")`,backgroundPosition:preview.imageFocalPosition||"center"} : undefined} />
    <div className={styles.overlay} />
    <div className={styles.texture} />
    <div className={styles.frame} />

    <section className={styles.header} data-region="header">
      <div className={styles.audience} data-reference-audience="true">{preview.audience.map((line)=><div key={line}>{line}</div>)}</div>
      <div className={styles.headline}>{preview.headline.map((line)=><div key={line}>{line}</div>)}</div>
      {preview.supportingLine && <div className={styles.supporting}>{preview.supportingLine}</div>}
      {preview.product && <div className={styles.product}>{preview.product}</div>}
    </section>

    <section className={styles.hero} data-region="hero">
      <div className={styles.heroLabel}>{preview.heroKind === "amount" ? preview.heroLabel : "PRIVATE COVERAGE REVIEW"}</div>
      <div className={styles.heroValue} data-reference-hero="true">{preview.hero.map((line)=><div key={line}>{line}</div>)}</div>
    </section>

    {preview.benefitBar && <div className={styles.benefitBar}>{preview.benefitBar}</div>}

    <section className={styles.benefits} data-region="benefits">
      {preview.benefits.map((benefit,index)=><div className={styles.benefit} key={benefit}>
        <span className={styles.icon}>{icons[index % icons.length]}</span><span>{benefit}</span>
      </div>)}
    </section>

    <section className={styles.age} data-region="age">
      <div className={styles.cta}>{preview.cta}</div>
      <div className={styles.ageGrid}>{preview.ageOptions.map((option)=><div className={styles.ageOption} data-reference-age-option="true" key={option}>{option}</div>)}</div>
    </section>
  </div>;
}
