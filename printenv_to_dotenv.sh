#!/bin/bash

# Mendapatkan variabel lingkungan dari AWS Elastic Beanstalk dan memformat outputnya
eb printenv | awk -F' = ' 'NF==2 {gsub(/^[ \t]+/, "", $1); print $1 "=" $2}' > .env
