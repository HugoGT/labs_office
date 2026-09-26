import styles from './MiEspacioPanel.module.css';

/**
 * Placeholder inerte de "Mi espacio" (dentro de "Personalizar", `OfficeSidebar`).
 * Disponible tanto para quien administra como para quien no: aqui no hay
 * ninguna guarda de rol, esa decision es de quien monta este componente.
 *
 * Sin funcionalidad real todavia -- subir pixel art, personalizar el propio
 * escritorio o el personaje llegan despues (#116). Este componente existe
 * solo para que "Personalizar" tenga un destino real y no un enlace muerto.
 */
export function MiEspacioPanel() {
  return (
    <section className={styles.section} aria-labelledby="mi-espacio-heading">
      <h3 className={styles.title} id="mi-espacio-heading">
        Mi espacio
      </h3>
      <p className={styles.body}>
        Próximamente: aquí podrás personalizar tu escritorio, tu personaje y subir tu propio
        pixel art.
      </p>
    </section>
  );
}
