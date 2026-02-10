#!/usr/bin/env python3
"""
Extract input cells from Mathematica notebooks.

Usage:
    python extract-inputs.py --single <file.nb>          # Single file, JSON to stdout
    python extract-inputs.py <input_dir> <output_dir>    # Directory mode

Requirements:
    pip install wolframclient
    Wolfram Engine or Mathematica must be installed
"""

import argparse
import json
import sys
from pathlib import Path
from wolframclient.evaluation import WolframLanguageSession


def extract_inputs_from_notebook(session, nb_path):
    """
    Extract input cells from a single notebook.
    
    Args:
        session: Active WolframLanguageSession
        nb_path: Path to the .nb file
        
    Returns:
        List of input cell contents as strings
    """
    try:
        # Escape the path for Wolfram Language string
        escaped_path = str(nb_path).replace('\\', '\\\\').replace('"', '\\"')
        
        # Build a single Wolfram Language command that does everything
        # This command:
        # 1. Imports the notebook
        # 2. Extracts input cells
        # 3. Filters out Null and Image inputs
        # 4. Converts them to pretty-formatted InputForm strings
        # 5. Returns a list of strings
        wl_code = f'''
        Module[{{nb, cells, inputs, filtered}},
            nb = Import["{escaped_path}", "NB"];
            If[nb === $Failed, Return[{{}}, Module]];
            
            cells = Cases[nb, Cell[content_, "Input", ___] :> content, Infinity];
            
            (* Convert to expressions and filter out Null and Image *)
            filtered = Select[cells,
                Function[content,
                    Module[{{expr}},
                        expr = ToExpression[content, StandardForm, HoldForm];
                        (* Check if it's not Null and doesn't contain Image *)
                        !MatchQ[expr, HoldForm[Null]] && 
                        FreeQ[expr, Image]
                    ]
                ]
            ];
            
            (* Convert remaining cells to pretty-formatted InputForm strings *)
            inputs = Map[
                Function[content,
                    Module[{{expr, formatted}},
                        expr = ToExpression[content, StandardForm, HoldForm];
                        (* Use ToString with PageWidth option for line breaks and indentation *)
                        formatted = ToString[expr, InputForm, PageWidth -> 80];
                        formatted
                    ]
                ],
                filtered
            ];
            
            inputs
        ]
        '''
        
        # Evaluate the code and get the result
        result = session.evaluate(wl_code)
        
        # Result should be a list of strings
        if result is None or result == []:
            return []
        
        # Convert to Python list of strings
        if isinstance(result, (list, tuple)):
            return [str(item) for item in result if item]
        else:
            return [str(result)] if result else []
        
    except Exception as e:
        print(f"Error processing {nb_path}: {e}", file=sys.stderr)
        return []


def save_inputs_to_file(inputs, output_path):
    """
    Save extracted inputs to a text file.
    
    Args:
        inputs: List of input strings
        output_path: Path where to save the output
    """
    with open(output_path, 'w', encoding='utf-8') as f:
        if not inputs:
            f.write("(No input cells found)\n")
            return
        
        for i, inp in enumerate(inputs, 1):
            f.write(f"(* Input {i} *)\n")
            f.write(f"{inp}\n\n")
            f.write(f"{'-' * 70}\n\n")


def process_directory(input_dir, output_dir):
    """
    Recursively process all .nb files in input_dir and save to output_dir.
    
    Args:
        input_dir: Directory containing Mathematica notebooks
        output_dir: Directory where output text files will be saved
    """
    input_path = Path(input_dir)
    output_path = Path(output_dir)
    
    # Validate input directory
    if not input_path.exists():
        print(f"Error: Input directory '{input_dir}' does not exist", 
              file=sys.stderr)
        sys.exit(1)
    
    if not input_path.is_dir():
        print(f"Error: '{input_dir}' is not a directory", file=sys.stderr)
        sys.exit(1)
    
    # Create output directory if it doesn't exist
    output_path.mkdir(parents=True, exist_ok=True)
    
    # Find all .nb files recursively
    nb_files = list(input_path.rglob("*.nb"))
    
    if not nb_files:
        print(f"No .nb files found in '{input_dir}'")
        return
    
    print(f"Found {len(nb_files)} notebook(s)")
    
    # Start Wolfram Language session
    print("Starting Wolfram Language session...")
    try:
        session = WolframLanguageSession()
    except Exception as e:
        print(f"Error: Could not start Wolfram Language session: {e}", 
              file=sys.stderr)
        print("Make sure Wolfram Engine or Mathematica is installed", 
              file=sys.stderr)
        sys.exit(1)
    
    try:
        processed = 0
        failed = 0
        
        for nb_file in nb_files:
            # Preserve directory structure relative to input_dir
            relative_path = nb_file.relative_to(input_path)
            
            # Create output filename (replace .nb with .txt)
            output_file = output_path / relative_path.with_suffix('.txt')
            
            # Create subdirectories if needed
            output_file.parent.mkdir(parents=True, exist_ok=True)
            
            print(f"Processing: {relative_path}")
            
            # Extract inputs
            inputs = extract_inputs_from_notebook(session, nb_file)
            
            # Save to file
            save_inputs_to_file(inputs, output_path=output_file)
            
            if inputs:
                print(f"  → Extracted {len(inputs)} input(s) to {output_file}")
                processed += 1
            else:
                print(f"  → No inputs found, created empty file at {output_file}")
                failed += 1
        
        print(f"\nSummary: {processed} file(s) processed successfully, "
              f"{failed} file(s) had no inputs or errors")
        
    finally:
        # Always terminate the session
        session.terminate()
        print("Wolfram Language session terminated")


def process_single_file(nb_path):
    """
    Process a single .nb file and print extracted inputs as JSON to stdout.
    """
    path = Path(nb_path)
    if not path.exists():
        print(f"Error: File '{nb_path}' does not exist", file=sys.stderr)
        sys.exit(1)
    if not path.suffix == '.nb':
        print(f"Error: '{nb_path}' is not a .nb file", file=sys.stderr)
        sys.exit(1)

    print("Starting Wolfram Language session...", file=sys.stderr)
    try:
        session = WolframLanguageSession()
    except Exception as e:
        print(f"Error: Could not start Wolfram Language session: {e}",
              file=sys.stderr)
        sys.exit(1)

    try:
        inputs = extract_inputs_from_notebook(session, path)
        # Output JSON to stdout
        print(json.dumps(inputs, ensure_ascii=False))
    finally:
        session.terminate()


def main():
    parser = argparse.ArgumentParser(
        description="Extract input cells from Mathematica notebooks",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python extract-inputs.py --single notebook.nb
  python extract-inputs.py ./notebooks ./outputs
        """
    )

    parser.add_argument(
        '--single',
        metavar='FILE',
        help='Extract inputs from a single .nb file (JSON to stdout)'
    )

    parser.add_argument(
        'input_dir',
        nargs='?',
        help='Directory containing Mathematica notebook files (.nb)'
    )

    parser.add_argument(
        'output_dir',
        nargs='?',
        help='Directory where extracted text files will be saved'
    )

    args = parser.parse_args()

    if args.single:
        process_single_file(args.single)
    elif args.input_dir and args.output_dir:
        process_directory(args.input_dir, args.output_dir)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()