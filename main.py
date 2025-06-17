# filename: main.py
import sys
import time
from PySide6.QtWidgets import QApplication, QWidget, QVBoxLayout, QLabel, QPushButton
from PySide6.QtCore import QTimer

def main():
    app = QApplication(sys.argv)
    window = QWidget()
    window.setWindowTitle("Minimal GUI App")

    layout = QVBoxLayout()
    
    seconds_label = QLabel("Seconds since start:")
    exit_button = QPushButton("Exit")
    
    layout.addWidget(QLabel("Hello World"))
    layout.addWidget(seconds_label)
    layout.addWidget(exit_button)
    
    window.setLayout(layout)

    start_time = time.time()

    def update_time():
        elapsed_time = int(time.time() - start_time)
        seconds_label.setText(f"Seconds since start: {elapsed_time}")
        print(f"Hello World - Elapsed Seconds: {elapsed_time}")

    exit_button.clicked.connect(window.close)
    
    timer = QTimer(window)
    timer.setInterval(1000)
    timer.timeout.connect(update_time)
    timer.start()

    window.show()
    sys.exit(app.exec())

if __name__ == "__main__":
    main()