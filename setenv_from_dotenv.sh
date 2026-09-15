#!/bin/bash

vars=""
while IFS= read -r line; do
    vars="$vars $line"
done < .env

eb setenv $vars
