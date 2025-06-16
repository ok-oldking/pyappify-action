import PySimpleGUI as sg
import time

def main():
    layout = [
        [sg.Text("Hello World Debug")],
        [sg.Text("Seconds since start:", key='-SECONDS-')],
        [sg.Button("Exit")]
    ]

    window = sg.Window("Minimal GUI App", layout, finalize=True)

    start_time = time.time()

    while True:
        event, values = window.read(timeout=1000) # Read with a timeout

        if event == sg.WIN_CLOSED or event == "Exit":
            break

        # Update the seconds text
        elapsed_time = int(time.time() - start_time)
        window['-SECONDS-'].update(f"Seconds since start: {elapsed_time}")

        # Print "Hello World" and the elapsed time to the console (for verification)
        print(f"Hello World Debug - Elapsed Seconds: {elapsed_time}")

    window.close()

if __name__ == "__main__":
    main()
